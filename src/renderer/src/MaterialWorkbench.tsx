import { SectionTitle } from "./ui-kit";
import { ClientButton } from "./client-ui";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Save,
  Plus,
  X,
  Layers,
  Upload,
  Image as ImageIcon,
} from "lucide-react";
import { ModelViewer, type ModelInfo } from "./viewers/ModelViewer";
import { Modal, Field, Loading } from "./components";
import { call, report, useStore } from "./store";
import { command as c, menuBindings, MoreButton } from "./ContextMenu";
import { ImageViewer } from "./viewers/ImageViewer";
import {
  defaultVariant,
  type Asset,
  type MaterialVariant,
  type TextureSlot,
  type Project,
} from "../../shared/types";
const slots: Record<TextureSlot, string> = {
  baseColor: "Base Color · 基础色",
  normal: "Normal · 法线",
  roughness: "Roughness · 粗糙度",
  metallic: "Metallic · 金属度",
  ao: "AO · 遮蔽",
  emission: "Emission · 自发光",
};
export function MaterialWorkbench({
  asset,
  onBack,
  onExport,
}: {
  asset: Asset;
  onBack: () => void;
  onExport: (variants: string[]) => void;
}) {
  const [variant, setVariant] = useState<MaterialVariant>(
      asset.metadata.draftVariant ?? defaultVariant(asset),
    ),
    [saved, setSaved] = useState<MaterialVariant[]>([]),
    [info, setInfo] = useState<ModelInfo | null>(null),
    [textures, setTextures] = useState<Asset[]>(
      asset.metadata.draftTextures ?? [],
    ),
    [picker, setPicker] = useState<TextureSlot | null>(null),
    [search, setSearch] = useState(""),
    [preview, setPreview] = useState<MaterialVariant | null>(null),
    [enabled, setEnabled] = useState(!!asset.metadata.draftVariant),
    [saving, setSaving] = useState(false);
  const [compare, setCompare] = useState(false),
    [compareId, setCompareId] = useState(""),
    [rename, setRename] = useState<MaterialVariant | null>(null),
    [renameName, setRenameName] = useState(""),
    [remove, setRemove] = useState<MaterialVariant | null>(null),
    [texturePreview, setTexturePreview] = useState<Asset | null>(null),
    [usage, setUsage] = useState<Record<string, string[]>>({});
  const [variantProject, setVariantProject] = useState<MaterialVariant | null>(
      null,
    ),
    [variantProjects, setVariantProjects] = useState<Project[]>([]);
  useEffect(() => {
    void call<Record<string, string[]>>("materials.usage", {
      assetId: asset.id,
    })
      .then(setUsage)
      .catch(report);
  }, [saved]);
  useEffect(() => {
    void call<MaterialVariant[]>("materials.list", { assetId: asset.id })
      .then(setSaved)
      .catch(report);
    void call<Asset[]>("materials.textures", { assetId: asset.id })
      .then((rows) =>
        setTextures((old) => [
          ...old,
          ...rows.filter((a) => !old.some((t) => t.id === a.id)),
        ]),
      )
      .catch(report);
    void call<any>("assets.query", { limit: 1000, showRelated: true })
      .then((p) =>
        setTextures((old) => [
          ...old,
          ...p.items.filter(
            (a: Asset) =>
              !old.some((t) => t.id === a.id) &&
              [
                ".png",
                ".jpg",
                ".jpeg",
                ".webp",
                ".tif",
                ".tiff",
                ".svg",
              ].includes(a.extension),
          ),
        ]),
      )
      .catch(report);
  }, [asset.id]);
  useEffect(() => {
    if (!picker) return;
    let cancelled = false;
    const timer = setTimeout(
      () =>
        void call<any>("assets.query", {
          imageOnly: true,
          showRelated: true,
          search,
          limit: 200,
        })
          .then((p) => {
            if (!cancelled)
              setTextures((old) => [
                ...p.items,
                ...old.filter(
                  (t) =>
                    Object.values(variant.bindings).some(
                      (b) => b?.assetId === t.id,
                    ) && !p.items.some((a: Asset) => a.id === t.id),
                ),
              ]);
          })
          .catch(report),
      150,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [picker, search]);
  useEffect(() => {
    const timer = setTimeout(() => setPreview(enabled ? variant : null), 120);
    return () => clearTimeout(timer);
  }, [variant, enabled]);
  function patch(change: Partial<MaterialVariant>) {
    setVariant((v) => ({ ...v, ...change }));
    setEnabled(true);
  }
  function initialize(model: ModelInfo) {
    setInfo(model);
    setVariant((v) => {
      if (v.id || enabled) return v;
      const m = model.materials.find((m) => m.index === v.materialIndex);
      return m
        ? {
            ...v,
            baseColor: m.color,
            roughness: m.roughness,
            metallic: m.metallic,
          }
        : v;
    });
  }
  const selectedMaterial = info?.materials.find(
      (m) => m.index === variant.materialIndex,
    ),
    editable =
      !!asset.metadata.materialSet ||
      ([".glb", ".gltf"].includes(asset.extension) &&
        !!selectedMaterial?.editable);
  async function save(input = variant) {
    setSaving(true);
    try {
      const value = await call<MaterialVariant>("materials.save", input);
      setVariant(value);
      setSaved((list) => [value, ...list.filter((v) => v.id !== value.id)]);
      useStore.getState().notify("材质变体已保存，原始模型保持不变");
      return value;
    } catch (e) {
      report(e);
    } finally {
      setSaving(false);
    }
  }
  function newVariant() {
    setVariant({
      ...defaultVariant(asset),
      baseColor: selectedMaterial?.color ?? "#ffffff",
      roughness: selectedMaterial?.roughness ?? 1,
      metallic: selectedMaterial?.metallic ?? 0,
    });
    setEnabled(false);
  }
  function variantCommands(v: MaterialVariant) {
    const value = { ...v };
    return [
      c("new", "新建变体", newVariant),
      c("copy", "复制变体", async () => {
        if (value.id) {
          const copy = await call<MaterialVariant>("materials.manage", {
            id: value.id,
            action: "copy",
          });
          setSaved((old) => [copy, ...old]);
          setVariant(copy);
        } else setVariant({ ...value, id: "", name: value.name + " 副本" });
        setEnabled(true);
      }),
      c("rename", "重命名…", () => {
        setRename(value);
        setRenameName(value.name);
      }),
      c("compare", "并排对照", () => {
        if (value.id) setCompareId(value.id);
        setCompare(true);
      }),
      c("export", "导出此变体", () => onExport([value.id]), {
        disabled: !value.id,
        reason: value.id ? undefined : "先保存变体",
      }),
      c(
        "save-export",
        "保存并导出…",
        async () => {
          const saved = await save(value);
          if (saved) onExport([saved.id]);
        },
        { disabled: !editable || saving },
      ),
      c(
        "project",
        "应用到项目…",
        async () => {
          setVariantProjects(await call<Project[]>("projects.list"));
          setVariantProject(value);
        },
        { disabled: !value.id, reason: value.id ? undefined : "先保存变体" },
      ),
      c("delete", "删除未引用变体…", () => setRemove(value), {
        danger: true,
        disabled: !value.id || !!usage[value.id]?.length,
        reason: usage[value.id]?.length
          ? `被 ${usage[value.id].join("、")} 引用`
          : !value.id
            ? "草稿尚未保存"
            : undefined,
      }),
    ];
  }
  function slotCommands(slot: TextureSlot) {
    const binding = variant.bindings[slot],
      tex = textures.find((t) => t.id === binding?.assetId);
    return [
      c("choose", binding ? "更换贴图…" : "选择贴图…", () => setPicker(slot), {
        disabled:
          !editable ||
          (!asset.metadata.materialSet && !info?.uvChannels.length),
        reason: !editable
          ? "材质为只读"
          : !asset.metadata.materialSet && !info?.uvChannels.length
            ? "模型缺少 UV"
            : undefined,
      }),
      ...(tex ? [c("preview", "查看贴图", () => setTexturePreview(tex))] : []),
      ...(binding
        ? [
            c(
              "clear",
              "清除绑定",
              () => {
                const bindings = { ...variant.bindings };
                delete bindings[slot];
                patch({ bindings });
              },
              { disabled: !editable },
            ),
          ]
        : []),
    ];
  }
  return (
    <div className="material-workbench">
      {compare && (
        <Modal title="材质变体并排对照" onClose={() => setCompare(false)} wide>
          <div className="compare-models">
            <section>
              <h3>当前编辑 · {variant.name}</h3>
              <ModelViewer
                asset={asset}
                variant={variant}
                textures={textures}
              />
            </section>
            <section>
              <select
                value={compareId}
                onChange={(e) => setCompareId(e.target.value)}
              >
                <option value="">原始材质</option>
                {saved.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
              <ModelViewer
                asset={asset}
                variant={saved.find((v) => v.id === compareId)}
                textures={textures}
              />
            </section>
          </div>
        </Modal>
      )}
      <div className="material-viewport">
        <header className="page-heading">
          <div>
            <ClientButton className="text-button" onClick={onBack}>
              <ArrowLeft size={16} />
              返回素材库
            </ClientButton>
            <SectionTitle as="h1" title={asset.title} />
            <p>
              材质工作台 <span className="separator">/</span> 版本{" "}
              {asset.revisionId.slice(0, 8)}
            </p>
          </div>
          <ClientButton
            onClick={() => setEnabled(!enabled)}
            className={enabled ? "primary" : ""}
          >
            {enabled ? "查看原始材质" : "查看当前变体"}
          </ClientButton>
        </header>
        <ModelViewer
          asset={asset}
          variant={preview}
          textures={textures}
          onReady={initialize}
        />
        <div className="variant-strip">
          <span>
            <Layers size={16} />
            材质变体
          </span>
          {saved.map((v) => (
            <ClientButton
              key={v.id}
              {...menuBindings(() => variantCommands(v))}
              className={variant.id === v.id ? "active" : ""}
              onClick={() => {
                setVariant(v);
                setEnabled(true);
              }}
            >
              {v.name}
            </ClientButton>
          ))}
          <MoreButton
            items={() => variantCommands(variant)}
            label="变体更多操作"
          />
        </div>
      </div>
      <aside className="material-panel">
        <div className="panel-title">
          <h2>材质参数</h2>
          <span>PBR</span>
          <MoreButton
            items={() => variantCommands(variant)}
            label="材质更多操作"
          />
        </div>
        <Field label="变体名称">
          <input
            value={variant.name}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </Field>
        <Field label="模型材质槽">
          <select
            value={variant.materialIndex}
            onChange={(e) => {
              const index = Number(e.target.value),
                m = info?.materials.find((m) => m.index === index);
              patch({
                materialIndex: index,
                ...(m
                  ? {
                      baseColor: m.color,
                      roughness: m.roughness,
                      metallic: m.metallic,
                    }
                  : {}),
              });
            }}
          >
            {info?.materials.map((m) => (
              <option key={m.index} value={m.index}>
                {m.name} {m.editable ? "" : "· 只读"}
              </option>
            ))}
          </select>
        </Field>
        {!editable && info && (
          <div className="warning">
            {[".glb", ".gltf"].includes(asset.extension)
              ? "当前材质不属于可编辑的标准 PBR。可查看原件，或选择其他材质槽。"
              : "材质变体支持 GLB/glTF 或 PBR 套组；其他模型请先生成 GLB 副本。"}
          </div>
        )}
        <fieldset disabled={!editable}>
          <h3>贴图通道</h3>
          {Object.entries(slots).map(([slot, label]) => {
            const binding = variant.bindings[slot as TextureSlot],
              tex = textures.find((t) => t.id === binding?.assetId);
            return (
              <div
                className="texture-slot"
                data-bound={!!binding}
                key={slot}
                tabIndex={0}
                {...menuBindings(() => slotCommands(slot as TextureSlot))}
              >
                <ClientButton
                  className="texture-pick"
                  onClick={() => setPicker(slot as TextureSlot)}
                >
                  {tex?.thumbnailUrl ? (
                    <img src={tex.thumbnailUrl} alt="" />
                  ) : (
                    <ImageIcon size={18} />
                  )}
                </ClientButton>
                <div>
                  <span>{label}</span>
                  <ClientButton
                    className="slot-name"
                    onClick={() => setPicker(slot as TextureSlot)}
                  >
                    {tex?.title ?? "选择本地贴图"}
                  </ClientButton>
                  {binding && (
                    <div className="binding-options">
                      <select
                        aria-label={`${label}通道`}
                        value={binding.channel}
                        onChange={(e) =>
                          patch({
                            bindings: {
                              ...variant.bindings,
                              [slot]: { ...binding, channel: e.target.value },
                            },
                          })
                        }
                      >
                        {["rgb", "r", "g", "b", "a"].map((c) => (
                          <option key={c} value={c}>
                            {c.toUpperCase()}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label={`${label}UV`}
                        value={binding.uv}
                        onChange={(e) =>
                          patch({
                            bindings: {
                              ...variant.bindings,
                              [slot]: {
                                ...binding,
                                uv: Number(e.target.value),
                              },
                            },
                          })
                        }
                      >
                        <option value="0">UV0</option>
                        <option value="1">UV1</option>
                      </select>
                    </div>
                  )}
                </div>
                <MoreButton
                  items={() => slotCommands(slot as TextureSlot)}
                  label={`${label}更多操作`}
                />
              </div>
            );
          })}
          <h3>表面属性</h3>
          <div className="color-field">
            <span>基础色</span>
            <input
              type="color"
              value={variant.baseColor}
              onChange={(e) => patch({ baseColor: e.target.value })}
            />
            <code>{variant.baseColor}</code>
          </div>
          {(
            ["roughness", "metallic", "normalScale", "aoStrength"] as const
          ).map((key, i) => (
            <label className="slider-field" key={key}>
              <span>
                {["粗糙度", "金属度", "法线强度", "AO 强度"][i]}
                <b>{variant[key].toFixed(2)}</b>
              </span>
              <input
                type="range"
                min="0"
                max={key === "normalScale" ? 5 : 1}
                step="0.01"
                value={variant[key]}
                onChange={(e) => patch({ [key]: Number(e.target.value) })}
              />
            </label>
          ))}
          <Field label="法线方向">
            <select
              value={variant.normalConvention}
              onChange={(e) =>
                patch({ normalConvention: e.target.value as "gl" | "dx" })
              }
            >
              <option value="gl">OpenGL · Godot</option>
              <option value="dx">DirectX · 导出时转换</option>
            </select>
          </Field>
          <div className="color-field">
            <span>自发光</span>
            <input
              type="color"
              value={variant.emission}
              onChange={(e) => patch({ emission: e.target.value })}
            />
            <input
              type="number"
              min="0"
              max="20"
              step=".1"
              value={variant.emissionStrength}
              onChange={(e) =>
                patch({ emissionStrength: Number(e.target.value) })
              }
            />
          </div>
          <h3>映射与透明</h3>
          <Field label="贴图过滤">
            <select
              value={variant.textureFilter ?? "linear"}
              onChange={(e) => patch({ textureFilter: e.target.value as any })}
            >
              <option value="linear">平滑过滤</option>
              <option value="nearest">最近邻 · 像素</option>
            </select>
          </Field>
          <div className="two-fields">
            {[0, 1].map((i) => (
              <Field key={i} label={`平铺 ${i ? "V" : "U"}`}>
                <input
                  type="number"
                  min=".01"
                  max="100"
                  step=".1"
                  value={variant.repeat[i]}
                  onChange={(e) => {
                    const repeat = [...variant.repeat] as [number, number];
                    repeat[i] = Number(e.target.value);
                    patch({ repeat });
                  }}
                />
              </Field>
            ))}
          </div>
          <div className="two-fields">
            {[0, 1].map((i) => (
              <Field key={i} label={`偏移 ${i ? "V" : "U"}`}>
                <input
                  type="number"
                  step=".1"
                  value={variant.offset[i]}
                  onChange={(e) => {
                    const offset = [...variant.offset] as [number, number];
                    offset[i] = Number(e.target.value);
                    patch({ offset });
                  }}
                />
              </Field>
            ))}
          </div>
          <Field label="UV 旋转（弧度）">
            <input
              type="number"
              step=".1"
              value={variant.rotation}
              onChange={(e) => patch({ rotation: Number(e.target.value) })}
            />
          </Field>
          <Field label="透明模式">
            <select
              value={variant.alphaMode}
              onChange={(e) => patch({ alphaMode: e.target.value as any })}
            >
              <option value="OPAQUE">不透明</option>
              <option value="MASK">Alpha 裁切</option>
              <option value="BLEND">Alpha 混合</option>
            </select>
          </Field>
          {variant.alphaMode === "MASK" && (
            <Field label="裁切阈值">
              <input
                type="number"
                min="0"
                max="1"
                step=".01"
                value={variant.alphaCutoff}
                onChange={(e) => patch({ alphaCutoff: Number(e.target.value) })}
              />
            </Field>
          )}
          <label className="check-label">
            <input
              type="checkbox"
              checked={variant.doubleSided}
              onChange={(e) => patch({ doubleSided: e.target.checked })}
            />
            双面显示
          </label>
        </fieldset>
        <div className="material-actions">
          <ClientButton
            className="primary"
            disabled={saving || !editable}
            onClick={() => void save()}
          >
            <Save size={16} />
            {saving ? "保存中…" : "保存变体"}
          </ClientButton>
          <ClientButton
            disabled={saving || !editable}
            onClick={async () => {
              const value = await save();
              if (value) onExport([value.id]);
            }}
          >
            <Upload size={16} />
            保存并导出…
          </ClientButton>
        </div>
      </aside>
      {rename && (
        <Modal title="重命名材质变体" onClose={() => setRename(null)}>
          <Field label="变体名称">
            <input
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
            />
          </Field>
          <ClientButton
            className="primary"
            disabled={!renameName.trim()}
            onClick={async () => {
              try {
                if (rename.id) {
                  const value = await call<MaterialVariant>(
                    "materials.manage",
                    {
                      id: rename.id,
                      action: "rename",
                      name: renameName.trim(),
                    },
                  );
                  setSaved((old) =>
                    old.map((v) => (v.id === value.id ? value : v)),
                  );
                  if (variant.id === value.id) setVariant(value);
                } else patch({ name: renameName.trim() });
                setRename(null);
              } catch (e) {
                report(e);
              }
            }}
          >
            保存名称
          </ClientButton>
        </Modal>
      )}
      {remove && (
        <Modal title="删除材质变体" onClose={() => setRemove(null)}>
          <p>删除「{remove.name}」？原始模型与贴图保留。</p>
          <ClientButton
            className="danger"
            onClick={async () => {
              try {
                await call("materials.manage", {
                  id: remove.id,
                  action: "delete",
                });
                setSaved((old) => old.filter((v) => v.id !== remove.id));
                if (variant.id === remove.id) newVariant();
                setRemove(null);
              } catch (e) {
                report(e);
              }
            }}
          >
            确认删除
          </ClientButton>
        </Modal>
      )}
      {texturePreview && (
        <Modal
          title={texturePreview.title}
          onClose={() => setTexturePreview(null)}
          wide
        >
          <div className="expanded-preview">
            <ImageViewer asset={texturePreview} />
          </div>
        </Modal>
      )}
      {variantProject && (
        <Modal
          title="为项目选择材质变体"
          onClose={() => setVariantProject(null)}
        >
          <p>
            将模型的此版本和「{variantProject.name}
            」固定到所选项目，快捷导出会使用这一变体。
          </p>
          {variantProjects.map((p) => (
            <ClientButton
              key={p.id}
              onClick={async () => {
                try {
                  await call("projects.attach", {
                    projectId: p.id,
                    assetIds: [asset.id],
                    variantId: variantProject.id,
                  });
                  setUsage(
                    await call("materials.usage", { assetId: asset.id }),
                  );
                  setVariantProject(null);
                  useStore.getState().notify(`已将变体用于 ${p.name}`);
                } catch (e) {
                  report(e);
                }
              }}
            >
              {p.name}
            </ClientButton>
          ))}
          {!variantProjects.length && <p>请先创建游戏项目。</p>}
        </Modal>
      )}
      {picker && (
        <Modal
          title={`选择贴图 · ${slots[picker]}`}
          onClose={() => setPicker(null)}
          wide
        >
          <input
            className="search-input"
            placeholder="搜索本地贴图名称或标签"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="texture-picker-grid">
            {textures
              .filter((t) =>
                [t.title, ...t.tags]
                  .join(" ")
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    patch({
                      bindings: {
                        ...variant.bindings,
                        [picker]: {
                          assetId: t.id,
                          revisionId: t.revisionId,
                          channel:
                            picker === "roughness"
                              ? "r"
                              : picker === "metallic"
                                ? "r"
                                : picker === "ao"
                                  ? "r"
                                  : "rgb",
                          uv: 0,
                        },
                      },
                    });
                    setPicker(null);
                  }}
                >
                  {t.thumbnailUrl ? (
                    <img src={t.thumbnailUrl} alt="" />
                  ) : (
                    <ImageIcon />
                  )}
                  <span>{t.title}</span>
                  <small>
                    {t.metadata.width} × {t.metadata.height}
                  </small>
                </button>
              ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
