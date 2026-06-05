export type ServerType = "vanilla" | "paper" | "fabric" | "forge";
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
