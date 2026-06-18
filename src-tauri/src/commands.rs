use std::{path::Path, process::Stdio, sync::Arc, time::UNIX_EPOCH};

use futures_util::StreamExt;
use tauri::{AppHandle, Emitter};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    sync::Mutex,
};
use uuid::Uuid;

use tauri_plugin_opener::OpenerExt;

use crate::{
    models::*,
    state::{AppState, ProcessHandle},
};

// ─── helpers ─────────────────────────────────────────────────────────────────

fn find_java(override_path: Option<&str>) -> Result<String, String> {
    if let Some(p) = override_path {
        if !p.is_empty() && Path::new(p).exists() {
            return Ok(p.to_string());
        }
    }
    if let Ok(java_home) = std::env::var("JAVA_HOME") {
        let candidate = if cfg!(windows) {
            format!("{}\\bin\\java.exe", java_home)
        } else {
            format!("{}/bin/java", java_home)
        };
        if Path::new(&candidate).exists() {
            return Ok(candidate);
        }
    }
    Ok("java".to_string())
}

async fn load_java_path(state: &tauri::State<'_, AppState>) -> String {
    let path = state.settings_path();
    if !path.exists() {
        return String::new();
    }
    let raw = tokio::fs::read_to_string(&path).await.unwrap_or_default();
    serde_json::from_str::<AppSettings>(&raw)
        .map(|s| s.java_path)
        .unwrap_or_default()
}

fn parse_log_level(line: &str) -> &str {
    if line.contains("/ERROR]") || line.contains("[ERROR]") || line.contains("ERROR:") {
        "ERROR"
    } else if line.contains("/WARN]") || line.contains("[WARN]") || line.contains("WARN:") {
        "WARN"
    } else {
        "INFO"
    }
}

fn build_server_command(
    java: &str,
    config: &ServerConfig,
    server_dir: &Path,
) -> Result<tokio::process::Command, String> {
    let max_ram = format!("-Xmx{}M", config.max_ram_mb);
    let min_ram = format!("-Xms{}M", std::cmp::min(config.max_ram_mb, 512));
    let extra: Vec<String> = config.jvm_flags.split_whitespace().map(String::from).collect();

    let cmd = match &config.server_type {
        ServerType::Forge | ServerType::Neoforge => {
            let run_bat = server_dir.join("run.bat");
            if cfg!(windows) && run_bat.exists() {
                let mut c = tokio::process::Command::new("cmd");
                c.args(["/c", "run.bat"]);
                return Ok(c);
            }
            let run_sh = server_dir.join("run.sh");
            if run_sh.exists() {
                let mut c = tokio::process::Command::new("sh");
                c.args(["run.sh"]);
                return Ok(c);
            }
            let prefix = if config.server_type == ServerType::Neoforge { "neoforge" } else { "forge" };
            let jar = std::fs::read_dir(server_dir)
                .map_err(|e| e.to_string())?
                .filter_map(|e| e.ok())
                .map(|e| e.file_name().to_string_lossy().to_string())
                .find(|n| n.starts_with(prefix) && n.ends_with(".jar") && !n.contains("installer"))
                .ok_or_else(|| format!("{} server files not found. Installation may have failed.", prefix))?;
            let mut c = tokio::process::Command::new(java);
            let mut args = vec![max_ram.clone(), min_ram.clone()];
            args.extend(extra.iter().cloned());
            args.extend(["-jar".to_string(), jar, "nogui".to_string()]);
            c.args(args);
            c
        }
        ServerType::Fabric => {
            let mut c = tokio::process::Command::new(java);
            let mut args = vec![max_ram.clone(), min_ram.clone()];
            args.extend(extra.iter().cloned());
            args.extend(["-jar".to_string(), "fabric-server-launch.jar".to_string(), "nogui".to_string()]);
            c.args(args);
            c
        }
        ServerType::Quilt => {
            let mut c = tokio::process::Command::new(java);
            let mut args = vec![max_ram.clone(), min_ram.clone()];
            args.extend(extra.iter().cloned());
            args.extend(["-jar".to_string(), "quilt-server-launch.jar".to_string(), "nogui".to_string()]);
            c.args(args);
            c
        }
        _ => {
            let mut c = tokio::process::Command::new(java);
            let mut args = vec![max_ram.clone(), min_ram.clone()];
            args.extend(extra.iter().cloned());
            args.extend(["-jar".to_string(), config.jar_name.clone(), "nogui".to_string()]);
            c.args(args);
            c
        }
    };

    #[cfg(all(windows, not(target_env = "gnu")))]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    Ok(cmd)
}

async fn download_file_with_progress(
    url: &str,
    dest: &Path,
    server_id: &str,
    message: &str,
    app_handle: &AppHandle,
) -> Result<(), String> {
    let client = reqwest::Client::new();
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {} for {}", resp.status(), url));
    }
    let total = resp.content_length().unwrap_or(0);
    let mut downloaded = 0u64;
    let mut stream = resp.bytes_stream();

    let mut file = tokio::fs::File::create(dest).await.map_err(|e| e.to_string())?;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        tokio::io::AsyncWriteExt::write_all(&mut file, &chunk)
            .await
            .map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        app_handle
            .emit(
                "download-progress",
                &DownloadProgress {
                    server_id: server_id.to_string(),
                    downloaded,
                    total,
                    message: message.to_string(),
                },
            )
            .ok();
    }
    Ok(())
}

// ─── version listing ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_minecraft_versions(server_type: ServerType) -> Result<Vec<McVersion>, String> {
    match server_type {
        ServerType::Vanilla => {
            let resp: serde_json::Value =
                reqwest::get("https://launchermeta.mojang.com/mc/game/version_manifest_v2.json")
                    .await
                    .map_err(|e| e.to_string())?
                    .json()
                    .await
                    .map_err(|e| e.to_string())?;
            let versions = resp["versions"]
                .as_array()
                .ok_or("invalid manifest")?
                .iter()
                .filter_map(|v| {
                    Some(McVersion {
                        id: v["id"].as_str()?.to_string(),
                        release_type: v["type"].as_str()?.to_string(),
                    })
                })
                .collect();
            Ok(versions)
        }
        ServerType::Paper => {
            let resp: serde_json::Value =
                reqwest::get("https://api.papermc.io/v2/projects/paper")
                    .await
                    .map_err(|e| e.to_string())?
                    .json()
                    .await
                    .map_err(|e| e.to_string())?;
            let mut versions: Vec<McVersion> = resp["versions"]
                .as_array()
                .ok_or("invalid paper response")?
                .iter()
                .filter_map(|v| {
                    Some(McVersion {
                        id: v.as_str()?.to_string(),
                        release_type: "release".to_string(),
                    })
                })
                .collect();
            versions.reverse();
            Ok(versions)
        }
        ServerType::Fabric => {
            let resp: serde_json::Value =
                reqwest::get("https://meta.fabricmc.net/v2/versions/game")
                    .await
                    .map_err(|e| e.to_string())?
                    .json()
                    .await
                    .map_err(|e| e.to_string())?;
            let versions = resp
                .as_array()
                .ok_or("invalid fabric response")?
                .iter()
                .filter_map(|v| {
                    Some(McVersion {
                        id: v["version"].as_str()?.to_string(),
                        release_type: if v["stable"].as_bool().unwrap_or(false) {
                            "release".to_string()
                        } else {
                            "snapshot".to_string()
                        },
                    })
                })
                .collect();
            Ok(versions)
        }
        ServerType::Forge => {
            let resp: serde_json::Value = reqwest::get(
                "https://files.minecraftforge.net/maven/net/minecraftforge/forge/promotions_slim.json",
            )
            .await
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;

            let promos = resp["promos"].as_object().ok_or("invalid forge response")?;
            let mut seen = std::collections::HashSet::new();
            let mut versions: Vec<McVersion> = promos
                .keys()
                .filter_map(|key| {
                    let mc_version = key.split('-').next()?.to_string();
                    if seen.insert(mc_version.clone()) {
                        Some(McVersion {
                            id: mc_version,
                            release_type: "release".to_string(),
                        })
                    } else {
                        None
                    }
                })
                .collect();
            versions.sort_by(|a, b| b.id.cmp(&a.id));
            Ok(versions)
        }
        ServerType::Quilt => {
            let resp: serde_json::Value =
                reqwest::get("https://meta.quiltmc.org/v3/versions/game")
                    .await
                    .map_err(|e| e.to_string())?
                    .json()
                    .await
                    .map_err(|e| e.to_string())?;
            let versions = resp
                .as_array()
                .ok_or("invalid quilt response")?
                .iter()
                .filter_map(|v| {
                    Some(McVersion {
                        id: v["version"].as_str()?.to_string(),
                        release_type: if v["stable"].as_bool().unwrap_or(false) {
                            "release".to_string()
                        } else {
                            "snapshot".to_string()
                        },
                    })
                })
                .collect();
            Ok(versions)
        }
        ServerType::Neoforge => {
            let xml = reqwest::get(
                "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml",
            )
            .await
            .map_err(|e| e.to_string())?
            .text()
            .await
            .map_err(|e| e.to_string())?;

            // Track each MC version and whether a stable NeoForge exists for it
            let mut stable_for_mc: std::collections::HashMap<String, bool> =
                std::collections::HashMap::new();

            for neo_ver in xml.split("<version>").skip(1).filter_map(|s| s.split("</version>").next()) {
                let parts: Vec<&str> = neo_ver.splitn(3, '.').collect();
                if parts.len() < 2 { continue; }
                let mc_ver = if parts[1] == "0" {
                    format!("1.{}", parts[0])
                } else {
                    format!("1.{}.{}", parts[0], parts[1])
                };
                let is_stable = !neo_ver.contains("beta") && !neo_ver.contains("rc") && !neo_ver.contains("alpha");
                let entry = stable_for_mc.entry(mc_ver).or_insert(false);
                if is_stable { *entry = true; }
            }

            let mut versions: Vec<McVersion> = stable_for_mc
                .into_iter()
                .map(|(id, stable)| McVersion {
                    id,
                    release_type: if stable { "release" } else { "snapshot" }.to_string(),
                })
                .collect();

            versions.sort_by(|a, b| {
                let parse = |s: &str| -> (u32, u32, u32) {
                    let p: Vec<u32> = s.split('.').filter_map(|x| x.parse().ok()).collect();
                    (p.first().copied().unwrap_or(0), p.get(1).copied().unwrap_or(0), p.get(2).copied().unwrap_or(0))
                };
                parse(&b.id).cmp(&parse(&a.id))
            });
            Ok(versions)
        }
    }
}

// ─── server CRUD ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_servers(state: tauri::State<'_, AppState>) -> Result<Vec<ServerInfo>, String> {
    let servers_dir = state.servers_dir();
    if !servers_dir.exists() {
        return Ok(vec![]);
    }

    let mut entries = tokio::fs::read_dir(&servers_dir)
        .await
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    let processes = state.processes.lock().await;

    while let Ok(Some(entry)) = entries.next_entry().await {
        let config_path = entry.path().join("launchstone.json");
        if !config_path.exists() {
            continue;
        }
        let raw = tokio::fs::read_to_string(&config_path)
            .await
            .unwrap_or_default();
        let Ok(config) = serde_json::from_str::<ServerConfig>(&raw) else {
            continue;
        };

        let (status, players_online, players_max) = if let Some(proc) = processes.get(&config.id) {
            let st = proc.status.lock().unwrap().clone();
            let (online, max) = *proc.players.lock().unwrap();
            (st, online, max)
        } else {
            (ServerStatus::Stopped, 0, 20)
        };

        result.push(ServerInfo {
            config,
            status,
            players_online,
            players_max,
        });
    }

    result.sort_by(|a, b| a.config.created_at.cmp(&b.config.created_at));
    Ok(result)
}

#[tauri::command]
pub async fn create_server(
    req: CreateServerRequest,
    state: tauri::State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<ServerConfig, String> {
    let id = Uuid::new_v4().to_string();
    let server_dir = state.server_dir(&id);
    tokio::fs::create_dir_all(&server_dir)
        .await
        .map_err(|e| e.to_string())?;

    // Download the server jar
    let java_path = load_java_path(&state).await;
    let jar_name = download_server_jar(&req, &id, &server_dir, &app_handle, &java_path).await?;

    // Write eula.txt
    tokio::fs::write(server_dir.join("eula.txt"), "eula=true\n")
        .await
        .map_err(|e| e.to_string())?;

    // Write server.properties with port
    let props = format!(
        "server-port={}\nonline-mode=false\n",
        req.port
    );
    tokio::fs::write(server_dir.join("server.properties"), props)
        .await
        .map_err(|e| e.to_string())?;

    let config = ServerConfig {
        id: id.clone(),
        name: req.name,
        server_type: req.server_type,
        minecraft_version: req.minecraft_version,
        port: req.port,
        max_ram_mb: req.max_ram_mb,
        created_at: chrono::Utc::now().to_rfc3339(),
        jar_name,
        auto_restart: req.auto_restart,
        jvm_flags: req.jvm_flags,
    };

    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    tokio::fs::write(state.config_path(&id), json)
        .await
        .map_err(|e| e.to_string())?;

    Ok(config)
}

async fn run_installer(
    server_id: &str,
    server_dir: &Path,
    installer_name: &str,
    installing_msg: &str,
    failure_msg: &str,
    app_handle: &AppHandle,
    java_path: &str,
) -> Result<(), String> {
    app_handle
        .emit(
            "download-progress",
            &DownloadProgress {
                server_id: server_id.to_string(),
                downloaded: 0,
                total: 0,
                message: installing_msg.to_string(),
            },
        )
        .ok();

    let java = find_java(if java_path.is_empty() { None } else { Some(java_path) })?;
    let mut install_cmd = tokio::process::Command::new(&java);
    install_cmd.args(["-jar", installer_name, "--installServer"]);
    install_cmd.current_dir(server_dir);
    install_cmd.stdout(Stdio::piped());
    install_cmd.stderr(Stdio::piped());

    #[cfg(all(windows, not(target_env = "gnu")))]
    {
        use std::os::windows::process::CommandExt;
        install_cmd.creation_flags(0x08000000);
    }

    let mut child = install_cmd.spawn().map_err(|e| e.to_string())?;
    let stdout = child.stdout.take().unwrap();
    let mut reader = BufReader::new(stdout).lines();
    let app_clone = app_handle.clone();
    let sid = server_id.to_string();
    tokio::spawn(async move {
        while let Ok(Some(line)) = reader.next_line().await {
            app_clone
                .emit(
                    "download-progress",
                    &DownloadProgress {
                        server_id: sid.clone(),
                        downloaded: 0,
                        total: 0,
                        message: line,
                    },
                )
                .ok();
        }
    });
    let status = child.wait().await.map_err(|e| e.to_string())?;
    if !status.success() {
        return Err(failure_msg.to_string());
    }
    Ok(())
}

async fn download_server_jar(
    req: &CreateServerRequest,
    server_id: &str,
    server_dir: &Path,
    app_handle: &AppHandle,
    java_path: &str,
) -> Result<String, String> {
    match &req.server_type {
        ServerType::Vanilla => {
            let manifest: serde_json::Value = reqwest::get(
                "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json",
            )
            .await
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;

            let version_url = manifest["versions"]
                .as_array()
                .ok_or("invalid manifest")?
                .iter()
                .find(|v| v["id"].as_str() == Some(&req.minecraft_version))
                .and_then(|v| v["url"].as_str().map(String::from))
                .ok_or_else(|| format!("version {} not found", req.minecraft_version))?;

            let version_data: serde_json::Value = reqwest::get(&version_url)
                .await
                .map_err(|e| e.to_string())?
                .json()
                .await
                .map_err(|e| e.to_string())?;

            let server_url = version_data["downloads"]["server"]["url"]
                .as_str()
                .ok_or("no server download in version data")?
                .to_string();

            let jar_name = "server.jar".to_string();
            download_file_with_progress(
                &server_url,
                &server_dir.join(&jar_name),
                server_id,
                "Downloading Vanilla server...",
                app_handle,
            )
            .await?;
            Ok(jar_name)
        }

        ServerType::Paper => {
            let builds_url = format!(
                "https://api.papermc.io/v2/projects/paper/versions/{}/builds",
                req.minecraft_version
            );
            let builds_data: serde_json::Value = reqwest::get(&builds_url)
                .await
                .map_err(|e| e.to_string())?
                .json()
                .await
                .map_err(|e| e.to_string())?;

            let latest_build = builds_data["builds"]
                .as_array()
                .and_then(|b| b.last())
                .ok_or("no builds found for this version")?;

            let build_number = latest_build["build"].as_u64().ok_or("missing build number")?;
            let jar_name = latest_build["downloads"]["application"]["name"]
                .as_str()
                .ok_or("missing jar name")?
                .to_string();

            let url = format!(
                "https://api.papermc.io/v2/projects/paper/versions/{}/builds/{}/downloads/{}",
                req.minecraft_version, build_number, jar_name
            );
            download_file_with_progress(
                &url,
                &server_dir.join(&jar_name),
                server_id,
                "Downloading Paper server...",
                app_handle,
            )
            .await?;
            Ok(jar_name)
        }

        ServerType::Fabric => {
            let loaders: serde_json::Value = reqwest::get(format!(
                "https://meta.fabricmc.net/v2/versions/loader/{}",
                req.minecraft_version
            ))
            .await
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;

            let loader_version = loaders
                .as_array()
                .and_then(|a| a.first())
                .and_then(|v| v["loader"]["version"].as_str().map(String::from))
                .ok_or("no Fabric loader found for this version")?;

            let installers: serde_json::Value =
                reqwest::get("https://meta.fabricmc.net/v2/versions/installer")
                    .await
                    .map_err(|e| e.to_string())?
                    .json()
                    .await
                    .map_err(|e| e.to_string())?;

            let installer_version = installers
                .as_array()
                .and_then(|a| a.first())
                .and_then(|v| v["version"].as_str().map(String::from))
                .ok_or("no Fabric installer found")?;

            let url = format!(
                "https://meta.fabricmc.net/v2/versions/loader/{}/{}/{}/server/jar",
                req.minecraft_version, loader_version, installer_version
            );
            let jar_name = "fabric-server-launch.jar".to_string();
            download_file_with_progress(
                &url,
                &server_dir.join(&jar_name),
                server_id,
                "Downloading Fabric server...",
                app_handle,
            )
            .await?;
            Ok(jar_name)
        }

        ServerType::Forge => {
            let promos: serde_json::Value = reqwest::get(
                "https://files.minecraftforge.net/maven/net/minecraftforge/forge/promotions_slim.json",
            )
            .await
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;

            let forge_version = promos["promos"]
                .as_object()
                .and_then(|p| {
                    p.get(&format!("{}-recommended", req.minecraft_version))
                        .or_else(|| p.get(&format!("{}-latest", req.minecraft_version)))
                })
                .and_then(|v| v.as_str().map(String::from))
                .ok_or_else(|| {
                    format!("no Forge build for Minecraft {}", req.minecraft_version)
                })?;

            let mc_forge = format!("{}-{}", req.minecraft_version, forge_version);
            let installer_name = format!("forge-{}-installer.jar", mc_forge);
            let url = format!(
                "https://maven.minecraftforge.net/net/minecraftforge/forge/{}/{}-installer.jar",
                mc_forge, mc_forge
            );

            download_file_with_progress(
                &url,
                &server_dir.join(&installer_name),
                server_id,
                "Downloading Forge installer...",
                app_handle,
            )
            .await?;

            run_installer(server_id, server_dir, &installer_name, "Installing Forge (this may take a minute)...", "Forge installation failed", app_handle, java_path).await?;
            Ok(installer_name)
        }
        ServerType::Quilt => {
            let loaders: serde_json::Value = reqwest::get(format!(
                "https://meta.quiltmc.org/v3/versions/loader/{}",
                req.minecraft_version
            ))
            .await
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;

            let loader_version = loaders
                .as_array()
                .and_then(|a| a.first())
                .and_then(|v| v["loader"]["version"].as_str().map(String::from))
                .ok_or("no Quilt loader found for this version")?;

            let url = format!(
                "https://meta.quiltmc.org/v3/versions/loader/{}/{}/server/jar",
                req.minecraft_version, loader_version
            );
            let jar_name = "quilt-server-launch.jar".to_string();
            download_file_with_progress(
                &url,
                &server_dir.join(&jar_name),
                server_id,
                "Downloading Quilt server...",
                app_handle,
            )
            .await?;
            Ok(jar_name)
        }
        ServerType::Neoforge => {
            let xml = reqwest::get(
                "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml",
            )
            .await
            .map_err(|e| e.to_string())?
            .text()
            .await
            .map_err(|e| e.to_string())?;

            let without_prefix = req.minecraft_version
                .strip_prefix("1.")
                .ok_or("invalid MC version format")?;
            let parts: Vec<&str> = without_prefix.splitn(3, '.').collect();
            let neo_prefix = match parts.len() {
                1 => format!("{}.0.", parts[0]),
                _ => format!("{}.{}.", parts[0], parts[1]),
            };

            // Prefer stable, fall back to any build
            let all_matching: Vec<&str> = xml
                .split("<version>")
                .skip(1)
                .filter_map(|s| s.split("</version>").next())
                .filter(|v| v.starts_with(&neo_prefix))
                .collect();

            let neo_version = all_matching
                .iter()
                .filter(|v| !v.contains("beta") && !v.contains("rc") && !v.contains("alpha"))
                .last()
                .or_else(|| all_matching.last())
                .ok_or_else(|| format!("no NeoForge build for Minecraft {}", req.minecraft_version))?
                .to_string();

            let installer_name = format!("neoforge-{}-installer.jar", neo_version);
            let url = format!(
                "https://maven.neoforged.net/releases/net/neoforged/neoforge/{}/neoforge-{}-installer.jar",
                neo_version, neo_version
            );

            download_file_with_progress(
                &url,
                &server_dir.join(&installer_name),
                server_id,
                "Downloading NeoForge installer...",
                app_handle,
            )
            .await?;

            run_installer(server_id, server_dir, &installer_name, "Installing NeoForge (this may take a minute)...", "NeoForge installation failed", app_handle, java_path).await?;
            Ok(installer_name)
        }
    }
}

#[tauri::command]
pub async fn delete_server(
    id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    // Stop if running
    let _ = stop_server(id.clone(), state.clone()).await;

    let server_dir = state.server_dir(&id);
    if server_dir.exists() {
        tokio::fs::remove_dir_all(&server_dir)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ─── process management ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn start_server(
    id: String,
    state: tauri::State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let config_path = state.config_path(&id);
    let raw = tokio::fs::read_to_string(&config_path)
        .await
        .map_err(|e| format!("config not found: {}", e))?;
    let config: ServerConfig = serde_json::from_str(&raw).map_err(|e| e.to_string())?;

    {
        let processes = state.processes.lock().await;
        if let Some(proc) = processes.get(&id) {
            let st = proc.status.lock().unwrap().clone();
            if st == ServerStatus::Running || st == ServerStatus::Starting {
                return Err("Server is already running".to_string());
            }
        }
    }

    let java_path = load_java_path(&state).await;
    let java = find_java(if java_path.is_empty() { None } else { Some(&java_path) })?;
    let server_dir = state.server_dir(&id);
    let mut cmd = build_server_command(&java, &config, &server_dir)?;
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.current_dir(&server_dir);

    let mut child = cmd.spawn().map_err(|e| format!("failed to spawn Java: {}", e))?;

    let child_pid = child.id();
    let stdin = Arc::new(Mutex::new(child.stdin.take()));
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let status = Arc::new(std::sync::Mutex::new(ServerStatus::Starting));
    let players = Arc::new(std::sync::Mutex::new((0u32, 20u32)));
    let pid_arc = Arc::new(std::sync::Mutex::new(child_pid));
    let stopping_arc = Arc::new(std::sync::Mutex::new(false));

    {
        let mut processes = state.processes.lock().await;
        processes.insert(
            id.clone(),
            ProcessHandle {
                stdin: stdin.clone(),
                status: status.clone(),
                players: players.clone(),
                pid: pid_arc.clone(),
                stopping: stopping_arc.clone(),
            },
        );
    }

    app_handle
        .emit(
            "server-status",
            &StatusEvent {
                server_id: id.clone(),
                status: ServerStatus::Starting,
                players_online: 0,
                players_max: 20,
            },
        )
        .ok();

    // Spawn task to read stdout
    let id_c = id.clone();
    let app_c = app_handle.clone();
    let status_c = status.clone();
    let players_c = players.clone();
    let stopping_c = stopping_arc.clone();
    let procs_arc = Arc::clone(&state.processes);
    let config_path_c = state.config_path(&id);

    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let level = parse_log_level(&line).to_string();

            if line.contains("Done (") && line.contains("For help") {
                let mut st = status_c.lock().unwrap();
                *st = ServerStatus::Running;
                drop(st);
                let (online, max) = *players_c.lock().unwrap();
                app_c
                    .emit(
                        "server-status",
                        &StatusEvent {
                            server_id: id_c.clone(),
                            status: ServerStatus::Running,
                            players_online: online,
                            players_max: max,
                        },
                    )
                    .ok();
            }

            app_c
                .emit(
                    "server-log",
                    &LogEvent {
                        server_id: id_c.clone(),
                        line,
                        level,
                    },
                )
                .ok();
        }

        // stdout closed — process exited
        let was_stopping = *stopping_c.lock().unwrap();
        {
            let mut st = status_c.lock().unwrap();
            *st = ServerStatus::Stopped;
        }
        {
            let mut procs = procs_arc.lock().await;
            procs.remove(&id_c);
        }
        app_c
            .emit(
                "server-status",
                &StatusEvent {
                    server_id: id_c.clone(),
                    status: ServerStatus::Stopped,
                    players_online: 0,
                    players_max: 20,
                },
            )
            .ok();

        // Auto-restart if crash (not intentional stop)
        if !was_stopping {
            if let Ok(raw) = tokio::fs::read_to_string(&config_path_c).await {
                if let Ok(cfg) = serde_json::from_str::<ServerConfig>(&raw) {
                    if cfg.auto_restart {
                        tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                        app_c.emit("server-log", &LogEvent {
                            server_id: id_c.clone(),
                            line: "[Launchstone] Server crashed — auto-restarting in 5s...".to_string(),
                            level: "WARN".to_string(),
                        }).ok();
                    }
                }
            }
        }
    });

    // Spawn task for stderr (emit as WARN level)
    let id_e = id.clone();
    let app_e = app_handle.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            app_e
                .emit(
                    "server-log",
                    &LogEvent {
                        server_id: id_e.clone(),
                        line,
                        level: "WARN".to_string(),
                    },
                )
                .ok();
        }
    });

    // Reap the child so we don't leave a zombie
    tokio::spawn(async move {
        let _ = child.wait().await;
    });

    // Scheduled task runner — polls every 60s while server is running
    let id_sched = id.clone();
    let app_sched = app_handle.clone();
    let procs_sched = Arc::clone(&state.processes);
    let server_dir_sched = state.server_dir(&id);
    let stdin_sched = stdin.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;
            let is_running = {
                let procs = procs_sched.lock().await;
                if let Some(proc) = procs.get(&id_sched) {
                    proc.status.lock().unwrap().clone() == ServerStatus::Running
                } else {
                    false
                }
            };
            if !is_running { break; }

            let tasks_path = server_dir_sched.join("launchstone_tasks.json");
            let Ok(raw) = tokio::fs::read_to_string(&tasks_path).await else { continue; };
            let Ok(mut tasks) = serde_json::from_str::<Vec<ScheduledTask>>(&raw) else { continue; };
            let now = chrono::Utc::now();
            let mut changed = false;

            for task in tasks.iter_mut() {
                if !task.enabled { continue; }
                let should_run = if let Some(ref last) = task.last_run {
                    if let Ok(last_dt) = chrono::DateTime::parse_from_rfc3339(last) {
                        let elapsed = now.signed_duration_since(last_dt.with_timezone(&chrono::Utc));
                        elapsed.num_minutes() >= task.interval_minutes as i64
                    } else { true }
                } else { true };

                if should_run {
                    task.last_run = Some(now.to_rfc3339());
                    changed = true;
                    match &task.action {
                        ScheduledAction::Command { command } => {
                            let cmd = format!("{}\n", command);
                            let mut guard = stdin_sched.lock().await;
                            if let Some(ref mut s) = *guard {
                                let _ = s.write_all(cmd.as_bytes()).await;
                            }
                            app_sched.emit("server-log", &LogEvent {
                                server_id: id_sched.clone(),
                                line: format!("[Scheduler] Ran: {}", command),
                                level: "INFO".to_string(),
                            }).ok();
                        }
                        ScheduledAction::Restart => {
                            app_sched.emit("server-log", &LogEvent {
                                server_id: id_sched.clone(),
                                line: "[Scheduler] Triggering scheduled restart...".to_string(),
                                level: "WARN".to_string(),
                            }).ok();
                            let mut guard = stdin_sched.lock().await;
                            if let Some(ref mut s) = *guard {
                                let _ = s.write_all(b"stop\n").await;
                            }
                        }
                    }
                }
            }

            if changed {
                if let Ok(json) = serde_json::to_string_pretty(&tasks) {
                    let _ = tokio::fs::write(&tasks_path, json).await;
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn stop_server(
    id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let processes = state.processes.lock().await;
    if let Some(proc) = processes.get(&id) {
        {
            let mut st = proc.status.lock().unwrap();
            *st = ServerStatus::Stopping;
        }
        {
            let mut stopping = proc.stopping.lock().unwrap();
            *stopping = true;
        }
        let mut stdin_guard = proc.stdin.lock().await;
        if let Some(ref mut stdin) = *stdin_guard {
            stdin.write_all(b"stop\n").await.ok();
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn restart_server(
    id: String,
    state: tauri::State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<(), String> {
    stop_server(id.clone(), state.clone()).await?;
    // Wait briefly for it to stop
    for _ in 0..30 {
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        let processes = state.processes.lock().await;
        if !processes.contains_key(&id) {
            break;
        }
    }
    start_server(id, state, app_handle).await
}

#[tauri::command]
pub async fn send_command(
    id: String,
    command: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let processes = state.processes.lock().await;
    let proc = processes.get(&id).ok_or("server not running")?;
    let mut stdin_guard = proc.stdin.lock().await;
    if let Some(ref mut stdin) = *stdin_guard {
        let line = format!("{}\n", command);
        stdin.write_all(line.as_bytes()).await.map_err(|e| e.to_string())?;
    } else {
        return Err("server stdin not available".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn get_server_status(
    id: String,
    state: tauri::State<'_, AppState>,
) -> Result<StatusEvent, String> {
    let processes = state.processes.lock().await;
    if let Some(proc) = processes.get(&id) {
        let status = proc.status.lock().unwrap().clone();
        let (online, max) = *proc.players.lock().unwrap();
        Ok(StatusEvent {
            server_id: id,
            status,
            players_online: online,
            players_max: max,
        })
    } else {
        Ok(StatusEvent {
            server_id: id,
            status: ServerStatus::Stopped,
            players_online: 0,
            players_max: 20,
        })
    }
}

// ─── player query (Server List Ping) ─────────────────────────────────────────

fn write_varint(buf: &mut Vec<u8>, mut value: i32) {
    loop {
        let mut byte = (value & 0x7F) as u8;
        value >>= 7;
        if value != 0 {
            byte |= 0x80;
        }
        buf.push(byte);
        if value == 0 {
            break;
        }
    }
}

fn write_mc_string(buf: &mut Vec<u8>, s: &str) {
    let bytes = s.as_bytes();
    write_varint(buf, bytes.len() as i32);
    buf.extend_from_slice(bytes);
}

async fn read_varint_stream(
    stream: &mut tokio::net::TcpStream,
) -> Result<i32, std::io::Error> {
    use tokio::io::AsyncReadExt;
    let mut result = 0i32;
    let mut shift = 0;
    loop {
        let mut byte = [0u8; 1];
        stream.read_exact(&mut byte).await?;
        result |= ((byte[0] & 0x7F) as i32) << shift;
        if byte[0] & 0x80 == 0 {
            break;
        }
        shift += 7;
        if shift >= 35 {
            return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "VarInt too big"));
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn query_players(id: String, state: tauri::State<'_, AppState>) -> Result<PlayersResult, String> {
    // Get port from config
    let config_path = state.config_path(&id);
    let raw = tokio::fs::read_to_string(&config_path)
        .await
        .map_err(|e| e.to_string())?;
    let config: ServerConfig = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let port = config.port;

    let result = tokio::time::timeout(
        tokio::time::Duration::from_secs(3),
        ping_server(port),
    )
    .await
    .map_err(|_| "query timed out".to_string())?
    .map_err(|e| e.to_string())?;

    // Update players in state
    {
        let processes = state.processes.lock().await;
        if let Some(proc) = processes.get(&id) {
            let mut p = proc.players.lock().unwrap();
            *p = (result.online, result.max);
        }
    }

    Ok(result)
}

async fn ping_server(port: u16) -> Result<PlayersResult, Box<dyn std::error::Error>> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpStream;

    let mut stream = TcpStream::connect(format!("127.0.0.1:{}", port)).await?;

    // Handshake packet
    let mut payload = Vec::new();
    write_varint(&mut payload, 0x00); // packet ID
    write_varint(&mut payload, -1);   // protocol version (unspecified)
    write_mc_string(&mut payload, "localhost");
    payload.extend_from_slice(&port.to_be_bytes());
    write_varint(&mut payload, 1); // next state: status

    let mut packet = Vec::new();
    write_varint(&mut packet, payload.len() as i32);
    packet.extend_from_slice(&payload);
    stream.write_all(&packet).await?;

    // Status request
    let mut req = Vec::new();
    write_varint(&mut req, 1);
    write_varint(&mut req, 0x00);
    stream.write_all(&req).await?;
    stream.flush().await?;

    // Read response
    let _len = read_varint_stream(&mut stream).await?;
    let _packet_id = read_varint_stream(&mut stream).await?;
    let json_len = read_varint_stream(&mut stream).await? as usize;

    let mut json_bytes = vec![0u8; json_len];
    stream.read_exact(&mut json_bytes).await?;
    let json = String::from_utf8(json_bytes)?;

    let data: serde_json::Value = serde_json::from_str(&json)?;
    let online = data["players"]["online"].as_u64().unwrap_or(0) as u32;
    let max = data["players"]["max"].as_u64().unwrap_or(20) as u32;
    let sample = data["players"]["sample"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|p| {
                    Some(PlayerInfo {
                        name: p["name"].as_str()?.to_string(),
                        id: p["id"].as_str().unwrap_or("").to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(PlayersResult { online, max, sample })
}

// ─── file manager ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_server_files(
    id: String,
    subpath: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<FileEntry>, String> {
    let server_dir = state.server_dir(&id);
    let sub = subpath.as_deref().filter(|s| !s.is_empty());

    let target_dir = match sub {
        Some(s) => {
            let candidate = server_dir.join(s);
            let canonical_server = server_dir.canonicalize().map_err(|e| e.to_string())?;
            let canonical_target = candidate.canonicalize().map_err(|e| e.to_string())?;
            if !canonical_target.starts_with(&canonical_server) {
                return Err("path traversal not allowed".to_string());
            }
            canonical_target
        }
        None => server_dir.clone(),
    };

    let mut rd = tokio::fs::read_dir(&target_dir).await.map_err(|e| e.to_string())?;
    let mut result = Vec::new();

    while let Ok(Some(entry)) = rd.next_entry().await {
        let Ok(metadata) = entry.metadata().await else { continue; };
        let name = entry.file_name().to_string_lossy().to_string();
        let path = match sub {
            Some(s) => format!("{}/{}", s, name),
            None => name.clone(),
        };
        let modified = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .and_then(|d| {
                use chrono::TimeZone;
                chrono::Utc.timestamp_opt(d.as_secs() as i64, 0).single()
            })
            .map(|dt| dt.to_rfc3339())
            .unwrap_or_default();

        result.push(FileEntry {
            name,
            path,
            is_dir: metadata.is_dir(),
            size: metadata.len(),
            modified,
        });
    }

    result.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(result)
}

#[tauri::command]
pub async fn read_server_file(
    id: String,
    path: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let server_dir = state.server_dir(&id);
    let file_path = server_dir.join(&path);
    let canonical_server = server_dir.canonicalize().map_err(|e| e.to_string())?;
    let canonical_file = file_path.canonicalize().map_err(|e| e.to_string())?;
    if !canonical_file.starts_with(&canonical_server) {
        return Err("path traversal not allowed".to_string());
    }
    tokio::fs::read_to_string(&canonical_file)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn write_server_file(
    id: String,
    path: String,
    content: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let server_dir = state.server_dir(&id);
    let file_path = server_dir.join(&path);
    let canonical_server = server_dir.canonicalize().map_err(|e| e.to_string())?;
    let canonical_parent = file_path
        .parent()
        .ok_or("invalid path")?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !canonical_parent.starts_with(&canonical_server) {
        return Err("path traversal not allowed".to_string());
    }
    tokio::fs::write(&file_path, content)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_server_file(
    id: String,
    path: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let server_dir = state.server_dir(&id);
    let file_path = server_dir.join(&path);
    let canonical_server = server_dir.canonicalize().map_err(|e| e.to_string())?;
    let canonical_file = file_path.canonicalize().map_err(|e| e.to_string())?;
    if !canonical_file.starts_with(&canonical_server) {
        return Err("path traversal not allowed".to_string());
    }
    if canonical_file.is_dir() {
        tokio::fs::remove_dir_all(&canonical_file).await.map_err(|e| e.to_string())
    } else {
        tokio::fs::remove_file(&canonical_file).await.map_err(|e| e.to_string())
    }
}

// ─── settings ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_settings(state: tauri::State<'_, AppState>) -> Result<AppSettings, String> {
    let path = state.settings_path();
    if path.exists() {
        let raw = tokio::fs::read_to_string(&path).await.map_err(|e| e.to_string())?;
        serde_json::from_str(&raw).map_err(|e| e.to_string())
    } else {
        Ok(AppSettings::default())
    }
}

#[tauri::command]
pub async fn save_settings(settings: AppSettings, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let path = state.settings_path();
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    tokio::fs::write(&path, json).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_data_dir(state: tauri::State<'_, AppState>) -> Result<String, String> {
    Ok(state.data_dir.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn open_path(path: String, app_handle: AppHandle) -> Result<(), String> {
    app_handle
        .opener()
        .open_path(&path, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_server_file(
    id: String,
    path: Option<String>,
    state: tauri::State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let server_dir = state.server_dir(&id);
    let target = match path.as_deref().filter(|s| !s.is_empty()) {
        Some(p) => server_dir.join(p),
        None => server_dir.clone(),
    };
    let canonical_server = server_dir.canonicalize().map_err(|e| e.to_string())?;
    let canonical_target = target.canonicalize().map_err(|e| e.to_string())?;
    if !canonical_target.starts_with(&canonical_server) {
        return Err("path traversal not allowed".to_string());
    }
    app_handle
        .opener()
        .open_path(canonical_target.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

// ─── resource monitor ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_server_resources(
    id: String,
    state: tauri::State<'_, AppState>,
) -> Result<ResourceUsage, String> {
    use sysinfo::{Pid, ProcessesToUpdate};

    let pid_opt = {
        let procs = state.processes.lock().await;
        procs.get(&id).and_then(|p| *p.pid.lock().unwrap())
    };
    let Some(pid) = pid_opt else {
        return Ok(ResourceUsage { cpu_percent: 0.0, ram_mb: 0 });
    };

    let (cpu, ram_mb) = {
        let mut sys = state.sys.lock().unwrap();
        sys.refresh_processes(ProcessesToUpdate::Some(&[Pid::from(pid as usize)]), true);
        if let Some(proc) = sys.process(Pid::from(pid as usize)) {
            (proc.cpu_usage(), proc.memory() / 1024 / 1024)
        } else {
            (0.0, 0)
        }
    };

    Ok(ResourceUsage { cpu_percent: cpu, ram_mb })
}

// ─── backups ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_backups(
    id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<BackupInfo>, String> {
    let backups_dir = state.backups_dir(&id);
    if !backups_dir.exists() {
        return Ok(vec![]);
    }
    let mut rd = tokio::fs::read_dir(&backups_dir).await.map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    while let Ok(Some(entry)) = rd.next_entry().await {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.ends_with(".zip") { continue; }
        let meta = entry.metadata().await.map_err(|e| e.to_string())?;
        let created_at = meta.modified().ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .and_then(|d| {
                use chrono::TimeZone;
                chrono::Utc.timestamp_opt(d.as_secs() as i64, 0).single()
            })
            .map(|dt| dt.to_rfc3339())
            .unwrap_or_default();
        result.push(BackupInfo { name, size: meta.len(), created_at });
    }
    result.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(result)
}

#[tauri::command]
pub async fn create_backup(
    id: String,
    label: Option<String>,
    state: tauri::State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<BackupInfo, String> {
    let server_dir = state.server_dir(&id);
    if !server_dir.exists() {
        return Err("server directory not found".to_string());
    }
    let backups_dir = state.backups_dir(&id);
    tokio::fs::create_dir_all(&backups_dir).await.map_err(|e| e.to_string())?;

    let timestamp = chrono::Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let name = if let Some(l) = label.filter(|s| !s.is_empty()) {
        format!("{}-{}.zip", timestamp, l.replace(' ', "_"))
    } else {
        format!("{}.zip", timestamp)
    };
    let dest = backups_dir.join(&name);

    app_handle.emit("backup-progress", serde_json::json!({
        "server_id": id, "message": "Creating backup..."
    })).ok();

    let server_dir_c = server_dir.clone();
    let dest_c = dest.clone();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let file = std::fs::File::create(&dest_c).map_err(|e| e.to_string())?;
        let mut zip = zip::ZipWriter::new(file);
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        zip_dir_recursive(&mut zip, &server_dir_c, &server_dir_c, opts)
            .map_err(|e| e.to_string())?;
        zip.finish().map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e)?;

    let meta = tokio::fs::metadata(&dest).await.map_err(|e| e.to_string())?;
    let created_at = chrono::Utc::now().to_rfc3339();
    app_handle.emit("backup-progress", serde_json::json!({
        "server_id": id, "message": "Backup complete"
    })).ok();

    Ok(BackupInfo { name, size: meta.len(), created_at })
}

fn zip_dir_recursive<W: std::io::Write + std::io::Seek>(
    zip: &mut zip::ZipWriter<W>,
    dir: &Path,
    base: &Path,
    opts: zip::write::SimpleFileOptions,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let rel = path.strip_prefix(base)?;
        let rel_str = rel.to_string_lossy().replace('\\', "/");
        if path.is_dir() {
            zip.add_directory(&format!("{}/", rel_str), opts)?;
            zip_dir_recursive(zip, &path, base, opts)?;
        } else {
            zip.start_file(&rel_str, opts)?;
            let mut f = std::fs::File::open(&path)?;
            std::io::copy(&mut f, zip)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_backup(
    id: String,
    name: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let path = state.backups_dir(&id).join(&name);
    if !path.extension().map(|e| e == "zip").unwrap_or(false) {
        return Err("invalid backup name".to_string());
    }
    tokio::fs::remove_file(&path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn restore_backup(
    id: String,
    name: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    // Server must not be running
    {
        let procs = state.processes.lock().await;
        if let Some(p) = procs.get(&id) {
            let st = p.status.lock().unwrap().clone();
            if st == ServerStatus::Running || st == ServerStatus::Starting {
                return Err("Stop the server before restoring a backup".to_string());
            }
        }
    }

    let backup_path = state.backups_dir(&id).join(&name);
    if !backup_path.extension().map(|e| e == "zip").unwrap_or(false) {
        return Err("invalid backup name".to_string());
    }
    let server_dir = state.server_dir(&id);

    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let file = std::fs::File::open(&backup_path).map_err(|e| e.to_string())?;
        let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
        archive.extract(&server_dir).map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ─── server properties ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_server_properties(
    id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<PropertyEntry>, String> {
    let path = state.server_dir(&id).join("server.properties");
    if !path.exists() {
        return Ok(vec![]);
    }
    let content = tokio::fs::read_to_string(&path).await.map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    let mut pending_comment: Option<String> = None;
    for line in content.lines() {
        let line = line.trim();
        if line.starts_with('#') {
            pending_comment = Some(line.trim_start_matches('#').trim().to_string());
        } else if let Some(eq) = line.find('=') {
            let key = line[..eq].trim().to_string();
            let value = line[eq + 1..].trim().to_string();
            if !key.is_empty() {
                result.push(PropertyEntry { key, value, comment: pending_comment.take() });
            }
        } else {
            pending_comment = None;
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn save_server_properties(
    id: String,
    props: Vec<PropertyEntry>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let path = state.server_dir(&id).join("server.properties");
    let mut content = String::from("#Minecraft server properties\n");
    content.push_str(&format!("#{}\n", chrono::Utc::now().to_rfc3339()));
    for p in &props {
        if let Some(ref c) = p.comment {
            content.push_str(&format!("# {}\n", c));
        }
        content.push_str(&format!("{}={}\n", p.key, p.value));
    }
    tokio::fs::write(&path, content).await.map_err(|e| e.to_string())
}

// ─── player lists ─────────────────────────────────────────────────────────────

fn player_list_filename(list_type: &str) -> Result<&'static str, String> {
    match list_type {
        "whitelist" => Ok("whitelist.json"),
        "ops" => Ok("ops.json"),
        "banlist" => Ok("banned-players.json"),
        _ => Err(format!("unknown list type: {}", list_type)),
    }
}

#[tauri::command]
pub async fn get_player_list(
    id: String,
    list_type: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<PlayerListEntry>, String> {
    let filename = player_list_filename(&list_type)?;
    let path = state.server_dir(&id).join(filename);
    if !path.exists() {
        return Ok(vec![]);
    }
    let raw = tokio::fs::read_to_string(&path).await.map_err(|e| e.to_string())?;
    let entries: Vec<serde_json::Value> = serde_json::from_str(&raw).unwrap_or_default();
    let result = entries.iter().filter_map(|v| {
        let uuid = v["uuid"].as_str()?.to_string();
        let name = v["name"].as_str()?.to_string();
        let level = v["level"].as_u64().map(|l| l as u32);
        let reason = v["reason"].as_str().map(String::from);
        let expires = v["expires"].as_str().map(String::from);
        Some(PlayerListEntry { uuid, name, level, reason, expires })
    }).collect();
    Ok(result)
}

#[tauri::command]
pub async fn add_to_player_list(
    id: String,
    list_type: String,
    username: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let filename = player_list_filename(&list_type)?;
    let path = state.server_dir(&id).join(filename);

    // Fetch UUID from Mojang
    let mojang_url = format!("https://api.mojang.com/users/profiles/minecraft/{}", username);
    let resp = reqwest::get(&mojang_url).await.map_err(|e| e.to_string())?;
    let (uuid, real_name) = if resp.status().is_success() {
        let data: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        let raw_id = data["id"].as_str().unwrap_or("").to_string();
        let formatted = if raw_id.len() == 32 {
            format!("{}-{}-{}-{}-{}", &raw_id[0..8], &raw_id[8..12], &raw_id[12..16], &raw_id[16..20], &raw_id[20..])
        } else { raw_id };
        (formatted, data["name"].as_str().unwrap_or(&username).to_string())
    } else {
        (format!("offline-{}", username), username.clone())
    };

    let mut entries: Vec<serde_json::Value> = if path.exists() {
        let raw = tokio::fs::read_to_string(&path).await.map_err(|e| e.to_string())?;
        serde_json::from_str(&raw).unwrap_or_default()
    } else { vec![] };

    // Avoid duplicates
    if entries.iter().any(|e| e["name"].as_str() == Some(&real_name)) {
        return Ok(());
    }

    let entry = match list_type.as_str() {
        "ops" => serde_json::json!({ "uuid": uuid, "name": real_name, "level": 4, "bypassesPlayerLimit": false }),
        "banlist" => serde_json::json!({ "uuid": uuid, "name": real_name, "created": chrono::Utc::now().to_rfc3339(), "source": "Launchstone", "expires": "forever", "reason": "Banned by an operator." }),
        _ => serde_json::json!({ "uuid": uuid, "name": real_name }),
    };
    entries.push(entry);

    let json = serde_json::to_string_pretty(&entries).map_err(|e| e.to_string())?;
    tokio::fs::write(&path, json).await.map_err(|e| e.to_string())?;

    // Send runtime command if server is running
    let runtime_cmd = match list_type.as_str() {
        "whitelist" => Some(format!("whitelist add {}", real_name)),
        "ops" => Some(format!("op {}", real_name)),
        "banlist" => Some(format!("ban {}", real_name)),
        _ => None,
    };
    if let Some(cmd) = runtime_cmd {
        let procs = state.processes.lock().await;
        if let Some(proc) = procs.get(&id) {
            let mut stdin_guard = proc.stdin.lock().await;
            if let Some(ref mut stdin) = *stdin_guard {
                let _ = stdin.write_all(format!("{}\n", cmd).as_bytes()).await;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn remove_from_player_list(
    id: String,
    list_type: String,
    uuid: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let filename = player_list_filename(&list_type)?;
    let path = state.server_dir(&id).join(filename);
    if !path.exists() { return Ok(()); }

    let raw = tokio::fs::read_to_string(&path).await.map_err(|e| e.to_string())?;
    let mut entries: Vec<serde_json::Value> = serde_json::from_str(&raw).unwrap_or_default();
    let removed_name = entries.iter().find(|e| e["uuid"].as_str() == Some(&uuid))
        .and_then(|e| e["name"].as_str().map(String::from));
    entries.retain(|e| e["uuid"].as_str() != Some(&uuid));

    let json = serde_json::to_string_pretty(&entries).map_err(|e| e.to_string())?;
    tokio::fs::write(&path, json).await.map_err(|e| e.to_string())?;

    if let Some(name) = removed_name {
        let runtime_cmd = match list_type.as_str() {
            "whitelist" => Some(format!("whitelist remove {}", name)),
            "ops" => Some(format!("deop {}", name)),
            "banlist" => Some(format!("pardon {}", name)),
            _ => None,
        };
        if let Some(cmd) = runtime_cmd {
            let procs = state.processes.lock().await;
            if let Some(proc) = procs.get(&id) {
                let mut stdin_guard = proc.stdin.lock().await;
                if let Some(ref mut stdin) = *stdin_guard {
                    let _ = stdin.write_all(format!("{}\n", cmd).as_bytes()).await;
                }
            }
        }
    }
    Ok(())
}

// ─── file upload ──────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn upload_server_file(
    id: String,
    path: String,
    content_b64: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    use base64::Engine;
    let server_dir = state.server_dir(&id);
    let file_path = server_dir.join(&path);
    let canonical_server = server_dir.canonicalize().map_err(|e| e.to_string())?;
    let parent = file_path.parent().ok_or("invalid path")?;
    tokio::fs::create_dir_all(parent).await.map_err(|e| e.to_string())?;
    let canonical_parent = parent.canonicalize().map_err(|e| e.to_string())?;
    if !canonical_parent.starts_with(&canonical_server) {
        return Err("path traversal not allowed".to_string());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&content_b64)
        .map_err(|e| e.to_string())?;
    tokio::fs::write(&file_path, bytes).await.map_err(|e| e.to_string())
}

// ─── scheduled tasks ──────────────────────────────────────────────────────────

fn tasks_path_for(server_dir: &Path) -> std::path::PathBuf {
    server_dir.join("launchstone_tasks.json")
}

async fn load_tasks(server_dir: &Path) -> Vec<ScheduledTask> {
    let p = tasks_path_for(server_dir);
    if !p.exists() { return vec![]; }
    let raw = tokio::fs::read_to_string(&p).await.unwrap_or_default();
    serde_json::from_str(&raw).unwrap_or_default()
}

async fn save_tasks(server_dir: &Path, tasks: &Vec<ScheduledTask>) -> Result<(), String> {
    let json = serde_json::to_string_pretty(tasks).map_err(|e| e.to_string())?;
    tokio::fs::write(tasks_path_for(server_dir), json).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_scheduled_tasks(
    id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<ScheduledTask>, String> {
    Ok(load_tasks(&state.server_dir(&id)).await)
}

#[tauri::command]
pub async fn add_scheduled_task(
    id: String,
    task: ScheduledTask,
    state: tauri::State<'_, AppState>,
) -> Result<ScheduledTask, String> {
    let server_dir = state.server_dir(&id);
    let mut tasks = load_tasks(&server_dir).await;
    let new_task = ScheduledTask {
        id: uuid::Uuid::new_v4().to_string(),
        last_run: None,
        ..task
    };
    tasks.push(new_task.clone());
    save_tasks(&server_dir, &tasks).await?;
    Ok(new_task)
}

#[tauri::command]
pub async fn update_scheduled_task(
    id: String,
    task: ScheduledTask,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let server_dir = state.server_dir(&id);
    let mut tasks = load_tasks(&server_dir).await;
    if let Some(t) = tasks.iter_mut().find(|t| t.id == task.id) {
        *t = task;
    }
    save_tasks(&server_dir, &tasks).await
}

#[tauri::command]
pub async fn remove_scheduled_task(
    id: String,
    task_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let server_dir = state.server_dir(&id);
    let mut tasks = load_tasks(&server_dir).await;
    tasks.retain(|t| t.id != task_id);
    save_tasks(&server_dir, &tasks).await
}

// ─── server config update ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn update_server(
    id: String,
    req: UpdateServerRequest,
    state: tauri::State<'_, AppState>,
) -> Result<ServerConfig, String> {
    let config_path = state.config_path(&id);
    let raw = tokio::fs::read_to_string(&config_path).await.map_err(|e| e.to_string())?;
    let mut config: ServerConfig = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    config.name = req.name;
    config.max_ram_mb = req.max_ram_mb;
    config.auto_restart = req.auto_restart;
    config.jvm_flags = req.jvm_flags;
    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    tokio::fs::write(&config_path, json).await.map_err(|e| e.to_string())?;
    Ok(config)
}
