use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ServerType {
    Vanilla,
    Paper,
    Fabric,
    Forge,
    Quilt,
    Neoforge,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub java_path: String,
    pub default_ram_mb: u32,
    pub default_port: u16,
    pub show_snapshots: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            java_path: String::new(),
            default_ram_mb: 2048,
            default_port: 25565,
            show_snapshots: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ServerStatus {
    Stopped,
    Starting,
    Running,
    Stopping,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    pub id: String,
    pub name: String,
    pub server_type: ServerType,
    pub minecraft_version: String,
    pub port: u16,
    pub max_ram_mb: u32,
    pub created_at: String,
    pub jar_name: String,
    #[serde(default)]
    pub auto_restart: bool,
    #[serde(default)]
    pub jvm_flags: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerInfo {
    #[serde(flatten)]
    pub config: ServerConfig,
    pub status: ServerStatus,
    pub players_online: u32,
    pub players_max: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateServerRequest {
    pub name: String,
    pub server_type: ServerType,
    pub minecraft_version: String,
    pub port: u16,
    pub max_ram_mb: u32,
    #[serde(default)]
    pub auto_restart: bool,
    #[serde(default)]
    pub jvm_flags: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateServerRequest {
    pub name: String,
    pub max_ram_mb: u32,
    pub auto_restart: bool,
    pub jvm_flags: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McVersion {
    pub id: String,
    pub release_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEvent {
    pub server_id: String,
    pub line: String,
    pub level: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusEvent {
    pub server_id: String,
    pub status: ServerStatus,
    pub players_online: u32,
    pub players_max: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadProgress {
    pub server_id: String,
    pub downloaded: u64,
    pub total: u64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerInfo {
    pub name: String,
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayersResult {
    pub online: u32,
    pub max: u32,
    pub sample: Vec<PlayerInfo>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: String,
}

// ─── new types ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupInfo {
    pub name: String,
    pub size: u64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ScheduledAction {
    Command { command: String },
    Restart,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduledTask {
    pub id: String,
    pub label: String,
    pub interval_minutes: u32,
    pub action: ScheduledAction,
    pub enabled: bool,
    pub last_run: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ResourceUsage {
    pub cpu_percent: f32,
    pub ram_mb: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerListEntry {
    pub uuid: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PropertyEntry {
    pub key: String,
    pub value: String,
    pub comment: Option<String>,
}
