import type { ServerType } from "../types";

const ICON_SRC: Record<ServerType, string> = {
  vanilla: "/icons/vanilla.png",
  paper: "/icons/paper.png",
  fabric: "/icons/fabric.png",
  forge: "/icons/forge.jpg",
};

// Fabric's logo has more internal whitespace — scale it up to visually match the others.
const ICON_SCALE: Partial<Record<ServerType, number>> = {
  fabric: 1.22,
};

interface Props {
  type: ServerType;
  size?: number;
}

export default function ServerTypeIcon({ type, size = 28 }: Props) {
  const renderSize = Math.round(size * (ICON_SCALE[type] ?? 1));
  return (
    <img
      src={ICON_SRC[type] ?? "/icons/vanilla.png"}
      alt={type}
      width={renderSize}
      height={renderSize}
      style={{ borderRadius: 4, objectFit: "contain" }}
    />
  );
}
