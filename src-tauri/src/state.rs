use std::{collections::HashMap, path::PathBuf, sync::Arc};
use tokio::process::ChildStdin;
use tokio::sync::Mutex;

use crate::models::ServerStatus;

pub struct ProcessHandle {
    pub stdin: Arc<Mutex<Option<ChildStdin>>>,
    pub status: Arc<std::sync::Mutex<ServerStatus>>,
    pub players: Arc<std::sync::Mutex<(u32, u32)>>,
    pub pid: Arc<std::sync::Mutex<Option<u32>>>,
    pub stopping: Arc<std::sync::Mutex<bool>>,
}

pub struct AppState {
    pub processes: Arc<Mutex<HashMap<String, ProcessHandle>>>,
    pub data_dir: PathBuf,
    pub sys: Arc<std::sync::Mutex<sysinfo::System>>,
}

impl AppState {
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            processes: Arc::new(Mutex::new(HashMap::new())),
            data_dir,
            sys: Arc::new(std::sync::Mutex::new(sysinfo::System::new())),
        }
    }

    pub fn servers_dir(&self) -> PathBuf {
        self.data_dir.join("servers")
    }

    pub fn server_dir(&self, id: &str) -> PathBuf {
        self.servers_dir().join(id)
    }

    pub fn config_path(&self, id: &str) -> PathBuf {
        self.server_dir(id).join("launchstone.json")
    }

    pub fn settings_path(&self) -> PathBuf {
        self.data_dir.join("settings.json")
    }

    pub fn backups_dir(&self, id: &str) -> PathBuf {
        self.data_dir.join("backups").join(id)
    }
}
