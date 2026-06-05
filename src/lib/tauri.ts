import { invoke } from "@tauri-apps/api/core";
import type {
  CreateServerRequest,
  FileEntry,
  McVersion,
  PlayersResult,
  ServerConfig,
  ServerInfo,
  ServerType,
  StatusEvent,
} from "../types";

export const listServers = (): Promise<ServerInfo[]> =>
  invoke("list_servers");

export const createServer = (req: CreateServerRequest): Promise<ServerConfig> =>
  invoke("create_server", { req });

export const deleteServer = (id: string): Promise<void> =>
  invoke("delete_server", { id });

export const startServer = (id: string): Promise<void> =>
  invoke("start_server", { id });

export const stopServer = (id: string): Promise<void> =>
  invoke("stop_server", { id });

export const restartServer = (id: string): Promise<void> =>
  invoke("restart_server", { id });

export const sendCommand = (id: string, command: string): Promise<void> =>
  invoke("send_command", { id, command });

export const getServerStatus = (id: string): Promise<StatusEvent> =>
  invoke("get_server_status", { id });

export const getMcVersions = (serverType: ServerType): Promise<McVersion[]> =>
  invoke("get_minecraft_versions", { serverType });

export const queryPlayers = (id: string): Promise<PlayersResult> =>
  invoke("query_players", { id });

export const listServerFiles = (id: string, subpath: string | null): Promise<FileEntry[]> =>
  invoke("list_server_files", { id, subpath });

export const readServerFile = (id: string, path: string): Promise<string> =>
  invoke("read_server_file", { id, path });

export const writeServerFile = (id: string, path: string, content: string): Promise<void> =>
  invoke("write_server_file", { id, path, content });

export const deleteServerFile = (id: string, path: string): Promise<void> =>
  invoke("delete_server_file", { id, path });

export const openServerFile = (id: string, path: string | null): Promise<void> =>
  invoke("open_server_file", { id, path });
