import type { ServerType } from "../types";

const ICON_SRC: Record<ServerType, string> = {
  vanilla: "/icons/vanilla.png",
  paper: "/icons/paper.png",
  fabric: "/icons/fabric.png",
  forge: "/icons/forge.jpg",
};

interface Props {
  type: ServerType;
  size?: number;
}

export default function ServerTypeIcon({ type, size = 28 }: Props) {
  return (
    <img
      src={ICON_SRC[type] ?? "/icons/vanilla.png"}
      alt={type}
      width={size}
      height={size}
      style={{ borderRadius: 4, objectFit: "contain" }}
    />
  );
}
