import { useEffect, useMemo, useState } from "react";
import { Button, SelectField, TextField } from "./ui-kit";
import { Modal } from "./components";
import { assetURL, call, report, useStore } from "./store";
import { SkinPreview } from "./SkinPreview";
import { Theme } from "./ui-kit";
import { ComponentSample, stateLabels } from "./ui-kit/samples";
import {
  builtinSkins,
  skinSlotRegistry,
  validateSkin,
  type SkinBinding,
  type SkinDefinition,
  type SkinManifest,
  type SkinPreset,
} from "../../shared/skins";
import type { Asset } from "../../shared/types";
interface Row {
  id: string;
  component: string;
  slot: SkinBinding["slot"];
  state: SkinBinding["state"];
  assetId: string;
  frame: string;
  fit: SkinBinding["fit"];
  slices: { top: number; right: number; bottom: number; left: number };
  contentInsets: { top: number; right: number; bottom: number; left: number };
  scale: 1 | 2;
}
const options = (values: readonly string[]) =>
  values.map((value) => ({ value, label: stateLabels[value] ?? value }));
export function SkinWizard({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated?: () => void;
}) {
  const [assets, setAssets] = useState<Asset[]>([]),
    [rows, setRows] = useState<Row[]>([]),
    [preset, setPreset] = useState<SkinPreset>("fresh"),
    [name, setName] = useState("我的皮肤"),
    [version, setVersion] = useState("1.0.0"),
    [author, setAuthor] = useState(""),
    [license, setLicense] = useState("仅个人使用；包含素材遵循各自原授权"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [urls, setUrls] = useState<Record<string, string>>({});
  const [draftId] = useState(() => `skin-${crypto.randomUUID()}`);
  useEffect(() => {
    void call<{ items: Asset[] }>("assets.query", {
      imageOnly: true,
      showRelated: true,
      includeAuxiliary: true,
      limit: 1000,
      sort: "title",
    })
      .then((r) => setAssets(r.items))
      .catch(report);
  }, []);
  const details = (row: Row) => {
    const asset = assets.find((a) => a.id === row.assetId),
      frame = asset?.metadata.atlas?.find((f: any) => f.name === row.frame);
    return {
      asset,
      frame,
      width: Math.max(
        1,
        Math.floor((frame?.width ?? asset?.metadata.width ?? 180) / row.scale),
      ),
      height: Math.max(
        1,
        Math.floor((frame?.height ?? asset?.metadata.height ?? 36) / row.scale),
      ),
    };
  };
  const manifest = useMemo<SkinManifest>(
    () => ({
      kind: "asset-workshop-skin",
      schemaVersion: 1,
      id: draftId,
      name,
      version,
      author,
      license,
      basePreset: preset,
      tokens: {},
      resources: rows
        .filter((r) => r.assetId)
        .map((r) => {
          const d = details(r);
          return {
            id: r.id,
            path: `resources/${r.id}${!r.frame && d.asset?.extension === ".svg" ? ".svg" : ".png"}`,
            width: d.width,
            height: d.height,
            scale: r.scale,
            atlasRegion: d.frame
              ? {
                  name: d.frame.name,
                  x: d.frame.x,
                  y: d.frame.y,
                  width: d.frame.width,
                  height: d.frame.height,
                  sourceWidth: d.asset!.metadata.width,
                  sourceHeight: d.asset!.metadata.height,
                }
              : undefined,
          };
        }),
      bindings: rows
        .filter((r) => r.assetId)
        .map((r) => ({
          component: r.component,
          slot: r.slot,
          state: r.state,
          resource: r.id,
          fit: r.fit,
          slices: r.fit === "nine-slice" ? r.slices : undefined,
          contentInsets: r.contentInsets,
          bleed: 0,
        })),
    }),
    [rows, assets, preset, name, version, author, license],
  );
  useEffect(() => {
    let active = true;
    void Promise.all(
      rows
        .filter((r) => r.assetId)
        .map(async (r) => {
          const d = details(r),
            a = d.asset!;
          const source =
            a.extension === ".svg"
              ? a.thumbnailUrl
              : assetURL(a.packageId, a.revisionId, a.path);
          if (!source) return [r.id, ""];
          if (!d.frame) return [r.id, source];
          const response = await fetch(source);
          if (!response.ok) throw new Error("来源图集无法加载");
          const objectURL = URL.createObjectURL(await response.blob());
          try {
            const image = new Image();
            image.src = objectURL;
            await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = d.frame.width;
            canvas.height = d.frame.height;
            canvas
              .getContext("2d")!
              .drawImage(
                image,
                d.frame.x,
                d.frame.y,
                d.frame.width,
                d.frame.height,
                0,
                0,
                canvas.width,
                canvas.height,
              );
            return [r.id, canvas.toDataURL("image/png")];
          } finally {
            URL.revokeObjectURL(objectURL);
          }
        }),
    )
      .then((values) => {
        if (active) setUrls(Object.fromEntries(values));
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [rows, assets]);
  const skin: SkinDefinition = {
    key: `draft-${draftId}`,
    builtin: false,
    manifest,
    urls,
  };
  const change = (id: string, patch: Partial<Row>) =>
    setRows((old) => old.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  function bindAsset(row: Row, id: string) {
    const a = assets.find((a) => a.id === id),
      scale: 1 | 2 = a?.metadata.skinResource?.scale === 2 ? 2 : 1,
      w = (a?.metadata.width ?? 180) / scale,
      h = (a?.metadata.height ?? 36) / scale;
    const s = a?.metadata.nineSlice
      ? (Object.fromEntries(
          Object.entries(a.metadata.nineSlice).map(([side, value]) => [
            side,
            Number(value) / scale,
          ]),
        ) as Row["slices"])
      : {
          top: Math.min(6, Math.floor(h / 3)),
          right: Math.min(6, Math.floor(w / 3)),
          bottom: Math.min(6, Math.floor(h / 3)),
          left: Math.min(6, Math.floor(w / 3)),
        };
    change(row.id, {
      assetId: id,
      frame: "",
      scale,
      slices: s,
      contentInsets: {
        top: Math.min(4, Math.floor(h / 4)),
        right: Math.min(12, Math.floor(w / 4)),
        bottom: Math.min(4, Math.floor(h / 4)),
        left: Math.min(12, Math.floor(w / 4)),
      },
    });
  }
  async function create() {
    setError("");
    setBusy(true);
    try {
      const checked = validateSkin(manifest);
      if (rows.some((r) => !r.assetId))
        throw new Error("请为每个新增槽位选择素材，或删除空槽位");
      const result = await call<{ skin: SkinDefinition; jobId: string }>(
        "skins.create",
        {
          manifest: checked,
          selections: rows.map((r) => {
            const d = details(r);
            return {
              resourceId: r.id,
              assetId: r.assetId,
              crop: d.frame
                ? {
                    x: d.frame.x,
                    y: d.frame.y,
                    width: d.frame.width,
                    height: d.frame.height,
                  }
                : undefined,
            };
          }),
        },
      );
      await call("skins.install", { key: result.skin.key });
      onCreated?.();
      useStore.getState().notify("皮肤已安装，保存到素材库的任务已创建");
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function insets(row: Row, key: "slices" | "contentInsets", label: string) {
    return (
      <div>
        <small>{label}（逻辑像素）</small>
        <div className="skin-insets">
          {(["top", "right", "bottom", "left"] as const).map((side, i) => (
            <label key={side}>
              {["上", "右", "下", "左"][i]}
              <input
                type="number"
                min={0}
                max={8192}
                aria-label={`${row.component} ${label}${side}`}
                value={row[key][side]}
                onChange={(e) =>
                  change(row.id, {
                    [key]: { ...row[key], [side]: Number(e.target.value) },
                  })
                }
              />
            </label>
          ))}
        </div>
      </div>
    );
  }
  return (
    <Modal
      title="素材组包 · 皮肤槽位向导"
      wide
      onClose={onClose}
      dismissOnBackdrop={!busy}
      closeDisabled={busy}
    >
      <fieldset
        disabled={busy}
        style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
      >
        <div className="skin-wizard">
          <div className="skin-wizard-fields">
            <p>
              选择素材填充视觉槽位。未绑定的控件使用基础风格，文字和交互仍由真实控件负责。
            </p>
            <SelectField
              label="基础风格"
              value={preset}
              options={builtinSkins.map((s) => ({
                value: s.manifest.basePreset,
                label: s.manifest.name,
              }))}
              onChange={(e) => setPreset(e.target.value as SkinPreset)}
            />
            <TextField
              label="皮肤名称"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <TextField
              label="皮肤版本"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
            />
            <TextField
              label="作者"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
            />
            <TextField
              label="整包授权说明"
              value={license}
              onChange={(e) => setLicense(e.target.value)}
            />
            <div className="skin-slot-list">
              {rows.map((row) => {
                const d = details(row);
                return (
                  <section className="skin-binding-row" key={row.id}>
                    <div className="skin-binding-grid">
                      <SelectField
                        label="组件"
                        value={row.component}
                        options={skinSlotRegistry.map((d) => ({
                          value: d.id,
                          label: d.label,
                        }))}
                        onChange={(e) =>
                          change(row.id, {
                            component: e.target.value,
                            slot: "background",
                            state: "default",
                          })
                        }
                      />
                      <SelectField
                        label="视觉槽位"
                        value={row.slot}
                        options={[
                          { value: "background", label: "底板" },
                          { value: "border", label: "边框" },
                          { value: "mark", label: "状态标记" },
                          { value: "decoration", label: "装饰" },
                          ...(skinSlotRegistry
                            .find((d) => d.id === row.component)!
                            .slots.includes("icon")
                            ? [
                                {
                                  value: "icon",
                                  label: "图标（已有图标的位置）",
                                },
                              ]
                            : []),
                        ]}
                        onChange={(e) =>
                          change(row.id, {
                            slot: e.target.value as Row["slot"],
                          })
                        }
                      />
                      <SelectField
                        label="状态"
                        value={row.state}
                        options={options(
                          skinSlotRegistry.find((d) => d.id === row.component)!
                            .states,
                        )}
                        onChange={(e) =>
                          change(row.id, {
                            state: e.target.value as Row["state"],
                          })
                        }
                      />
                      <SelectField
                        label="缩放方式"
                        value={row.fit}
                        options={[
                          { value: "nine-slice", label: "九宫格" },
                          { value: "stretch", label: "拉伸" },
                          { value: "contain", label: "等比适配" },
                          { value: "tile", label: "纹理平铺" },
                        ]}
                        onChange={(e) =>
                          change(row.id, { fit: e.target.value as Row["fit"] })
                        }
                      />
                    </div>
                    <SelectField
                      label="来源素材"
                      value={row.assetId}
                      options={[
                        { value: "", label: "请选择图片" },
                        ...assets.map((a) => ({
                          value: a.id,
                          label: `${a.title} · ${a.path}`,
                        })),
                      ]}
                      onChange={(e) => bindAsset(row, e.target.value)}
                    />
                    {d.asset?.metadata.atlas?.length > 0 && (
                      <SelectField
                        label="图集区域"
                        value={row.frame}
                        options={[
                          { value: "", label: "整张图片" },
                          ...(d.asset?.metadata.atlas ?? []).map((f: any) => ({
                            value: f.name,
                            label: `${f.name} · ${f.width}×${f.height}`,
                          })),
                        ]}
                        onChange={(e) =>
                          change(row.id, { frame: e.target.value })
                        }
                      />
                    )}
                    <SelectField
                      label="原图倍率"
                      value={String(row.scale)}
                      options={[
                        { value: "1", label: "1×" },
                        { value: "2", label: "2×" },
                      ]}
                      onChange={(e) =>
                        change(row.id, {
                          scale: Number(e.target.value) as 1 | 2,
                        })
                      }
                    />
                    {row.fit === "nine-slice" &&
                      insets(row, "slices", "九宫格切片")}
                    {insets(row, "contentInsets", "文字安全区")}
                    <small>
                      逻辑尺寸：{d.width} × {d.height}；来源授权：
                      {d.asset?.source?.license ?? "未知"}
                    </small>
                    <Button
                      variant="danger"
                      onClick={() =>
                        setRows((old) => old.filter((r) => r.id !== row.id))
                      }
                    >
                      删除槽位
                    </Button>
                  </section>
                );
              })}
            </div>
            <Button
              onClick={() =>
                setRows((old) => [
                  ...old,
                  {
                    id: `r-${crypto.randomUUID()}`,
                    component: "primary-button",
                    slot: "background",
                    state: "default",
                    assetId: "",
                    frame: "",
                    fit: "nine-slice",
                    scale: 1,
                    slices: { top: 6, right: 6, bottom: 6, left: 6 },
                    contentInsets: { top: 4, right: 12, bottom: 4, left: 12 },
                  },
                ])
              }
            >
              添加视觉槽位
            </Button>
            {error && (
              <p role="alert" className="skin-error">
                {error}
              </p>
            )}
            <Button
              variant="primary"
              loading={busy}
              onClick={() => void create()}
            >
              校验并生成皮肤包
            </Button>
          </div>
          <div className="skin-wizard-preview">
            <SkinPreview skin={skin} />
            {rows.at(-1) && (
              <Theme skin={skin} motion="none" className="skin-slot-preview">
                <h3>
                  当前槽位 ·{" "}
                  {
                    skinSlotRegistry.find(
                      (d) => d.id === rows.at(-1)!.component,
                    )?.label
                  }{" "}
                  · {stateLabels[rows.at(-1)!.state] ?? rows.at(-1)!.state}
                </h3>
                <div style={{ position: "relative", padding: 12 }}>
                  <ComponentSample
                    key={`${rows.at(-1)!.component}-${rows.at(-1)!.state}`}
                    kind={rows.at(-1)!.component}
                    state={rows.at(-1)!.state}
                  />
                </div>
                <p>文字保持原生绘制。切片与安全区通过校验后随素材索引导出。</p>
              </Theme>
            )}
          </div>
        </div>
      </fieldset>
    </Modal>
  );
}
