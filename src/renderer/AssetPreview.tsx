import { useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import type { Asset } from "../contracts/model";

export const previewUrl = (projectId: string, asset: Asset, detail = false) =>
  `media://${detail ? "preview" : "thumbnail"}/${projectId}/${asset.id}?revision=${asset.sha256}&modified=${asset.modifiedMs}`;

export function AssetPreview({
  projectId,
  asset,
  alt = "",
  detail = false,
}: {
  projectId: string;
  asset: Asset;
  alt?: string;
  detail?: boolean;
}) {
  const url = previewUrl(projectId, asset, detail);
  const [loaded, setLoaded] = useState("");
  const [failed, setFailed] = useState("");
  const unavailable = asset.availability && asset.availability !== "available";
  return (
    <span className={`asset-preview ${loaded === url ? "loaded" : ""}`}>
      {failed === url || unavailable ? (
        <span
          className="preview-placeholder"
          role="img"
          aria-label={`${alt || asset.name}：预览不可用`}
        >
          <ImageIcon size={22} />
          <small>预览不可用</small>
        </span>
      ) : (
        <>
          {loaded !== url && (
            <span className="preview-placeholder" aria-hidden="true">
              <ImageIcon size={22} />
            </span>
          )}
          <img
            src={url}
            alt={alt}
            loading={detail ? "eager" : "lazy"}
            decoding="async"
            onLoad={() => setLoaded(url)}
            onError={() => setFailed(url)}
          />
        </>
      )}
    </span>
  );
}
