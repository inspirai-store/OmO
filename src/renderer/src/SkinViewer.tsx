import { useEffect, useState } from "react";
import type { Asset } from "../../shared/types";
import type { SkinDefinition } from "../../shared/skins";
import { Button } from "./ui-kit";
import { call, report, useStore } from "./store";
import { useAppearance } from "./Appearance";
import { SkinPreview } from "./SkinPreview";
import { saveSkinExport } from "./SkinSettings";
export function SkinViewer({
  asset,
  compact = false,
}: {
  asset: Asset;
  compact?: boolean;
}) {
  const [skin, setSkin] = useState<SkinDefinition>(),
    [busy, setBusy] = useState(false),
    [parts, setParts] = useState<Asset[] | null>(null),
    [error, setError] = useState("");
  const appearance = useAppearance();
  useEffect(() => {
    let active = true;
    void call<SkinDefinition>("skins.preview", { assetId: asset.id })
      .then((s) => {
        if (active) setSkin(s);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [asset.id]);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  };
  if (error)
    return (
      <p role="alert" className="skin-error">
        {error}
      </p>
    );
  if (!skin) return <p>正在校验皮肤资源…</p>;
  return (
    <div className="skin-detail">
      <SkinPreview skin={skin} compact={compact} />
      <p>
        {skin.manifest.author} · {skin.manifest.license}
      </p>
      <div className="skin-actions">
        <Button
          loading={busy}
          variant="primary"
          onClick={() =>
            void run(async () => {
              await call("skins.install", { key: skin.key });
              await appearance.apply({ skinKey: skin.key });
              useStore.getState().notify("皮肤已应用");
            })
          }
        >
          安装并应用
        </Button>
        <Button
          disabled={busy}
          onClick={() => void run(() => saveSkinExport(skin, "package"))}
        >
          导出皮肤包
        </Button>
        <Button
          disabled={busy}
          onClick={() => void run(() => saveSkinExport(skin, "resources"))}
        >
          拆分素材
        </Button>
      </div>
      <small>
        包含 {skin.manifest.resources.length} 个源素材 ·{" "}
        {skin.manifest.bindings.length} 个槽位绑定
      </small>
      <div className="skin-resource-list">
        <Button
          onClick={() =>
            void call<{ items: Asset[] }>("assets.query", {
              showRelated: true,
              includeAuxiliary: false,
              limit: 1000,
              search: asset.metadata.skin.id,
            })
              .then((result) =>
                setParts(
                  result.items.filter(
                    (a) =>
                      a.packageId === asset.packageId &&
                      a.revisionId === asset.revisionId &&
                      a.id !== asset.id,
                  ),
                ),
              )
              .catch(report)
          }
        >
          查看包含的视觉素材
        </Button>
        {parts?.map((part) => (
          <Button
            key={part.id}
            variant="ghost"
            onClick={() => {
              useStore
                .getState()
                .setQuery({
                  category: "controls",
                  showRelated: true,
                  search: part.path,
                });
              useStore.getState().setSelection([part.id], part.id);
            }}
          >
            {part.title} · {part.path}
          </Button>
        ))}
        {skin.manifest.resources.map((r) => (
          <Button
            key={r.id}
            variant="ghost"
            onClick={() =>
              void call<any>("assets.query", {
                search: r.path,
                showRelated: true,
                limit: 100,
              })
                .then((result) => {
                  const found = result.items.find(
                    (a: Asset) =>
                      a.packageId === asset.packageId &&
                      a.revisionId === asset.revisionId &&
                      a.metadata.skinResource?.resourceId === r.id,
                  );
                  if (found)
                    useStore.getState().setSelection([found.id], found.id);
                })
                .catch(report)
            }
          >
            {r.path} · {r.width}×{r.height} ·{" "}
            {r.source?.license ?? skin.manifest.license}
          </Button>
        ))}
      </div>
    </div>
  );
}
