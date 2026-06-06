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
            c.args([&max_ram, &min_ram, "-jar", &jar, "nogui"]);
            c
        }
        ServerType::Fabric => {
            let mut c = tokio::process::Command::new(java);
            c.args([&max_ram, &min_ram, "-jar", "fabric-server-launch.jar", "nogui"]);
            c
        }
        ServerType::Quilt => {
            let mut c = tokio::process::Command::new(java);
            c.args([&max_ram, &min_ram, "-jar", "quilt-server-launch.jar", "nogui"]);
            c
        }
        _ => {
            let mut c = tokio::process::Command::new(java);
            c.args([&max_ram, &min_ram, "-jar", &config.jar_name, "nogui"]);
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

    let stdin = Arc::new(Mutex::new(child.stdin.take()));
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let status = Arc::new(std::sync::Mutex::new(ServerStatus::Starting));
    let players = Arc::new(std::sync::Mutex::new((0u32, 20u32)));

    {
        let mut processes = state.processes.lock().await;
        processes.insert(
            id.clone(),
            ProcessHandle {
                stdin: stdin.clone(),
                status: status.clone(),
                players: players.clone(),
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
    let procs_arc = Arc::clone(&state.processes);

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
