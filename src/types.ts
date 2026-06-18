export type ServerType =
  | "vanilla"
  | "paper"
  | "fabric"
  | "forge"
  | "quilt"
  | "neoforge";

export type ServerStatus = "stopped" | "starting" | "running" | "stopping";

export interface ServerConfig {
  id: string;
  name: string;
  server_type: ServerType;
  minecraft_version: string;
  port: number;
  max_ram_mb: number;
  created_at: string;
  jar_name: string;
  auto_restart: boolean;
  jvm_flags: string;
}

export interface ServerInfo extends ServerConfig {
  status: ServerStatus;
  players_online: number;
  players_max: number;
}

export interface McVersion {
  id: string;
  release_type: string;
}

export interface CreateServerRequest {
  name: string;
  server_type: ServerType;
  minecraft_version: string;
  port: number;
  max_ram_mb: number;
  auto_restart: boolean;
  jvm_flags: string;
}

export interface UpdateServerRequest {
  name: string;
  max_ram_mb: number;
  auto_restart: boolean;
  jvm_flags: string;
}

export interface LogEvent {
  server_id: string;
  line: string;
  level: "INFO" | "WARN" | "ERROR";
}

export interface StatusEvent {
  server_id: string;
  status: ServerStatus;
  players_online: number;
  players_max: number;
}

export interface DownloadProgress {
  server_id: string;
  downloaded: number;
  total: number;
  message: string;
}

export interface PlayerInfo {
  name: string;
  id: string;
}

export interface PlayersResult {
  online: number;
  max: number;
  sample: PlayerInfo[];
}

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: string;
}

export interface AppSettings {
  java_path: string;
  default_ram_mb: number;
  default_port: number;
  show_snapshots: boolean;
}

export interface BackupInfo {
  name: string;
  size: number;
  created_at: string;
}

export type ScheduledAction =
  | { type: "command"; command: string }
  | { type: "restart" };

export interface ScheduledTask {
  id: string;
  label: string;
  interval_minutes: number;
  action: ScheduledAction;
  enabled: boolean;
  last_run: string | null;
}

export interface ResourceUsage {
  cpu_percent: number;
  ram_mb: number;
}

export interface PlayerListEntry {
  uuid: string;
  name: string;
  level?: number;
  reason?: string;
  expires?: string;
}

export interface PropertyEntry {
  key: string;
  value: string;
  comment?: string;
}
