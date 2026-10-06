import { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { WorkshopFBXLoader } from "./WorkshopFBXLoader";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { EXRLoader } from "three/addons/loaders/EXRLoader.js";
import { TGALoader } from "three/addons/loaders/TGALoader.js";
import { DDSLoader } from "three/addons/loaders/DDSLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import {
  Camera,
  RotateCcw,
  Play,
  Pause,
  Box,
  AlertTriangle,
} from "lucide-react";
import type {
  Asset,
  MaterialVariant,
  TextureSlot,
} from "../../../shared/types";
import { assetURL, call, report, useStore } from "../store";
import {
  command as c,
  group as g,
  menuBindings,
  MoreButton,
} from "../ContextMenu";
import { Modal } from "../components";

export interface ModelInfo {
  triangles: number;
  vertices: number;
  uvChannels: number[];
  materials: {
    index: number;
    name: string;
    color: string;
    roughness: number;
    metallic: number;
    editable: boolean;
  }[];
  animations: { name: string; duration: number }[];
  nodes: { uuid: string; name: string }[];
}
interface ModelAPI {
  apply: (v: MaterialVariant | null) => Promise<void>;
  mode: (value: string) => void;
  reset: () => void;
  projection: (orthographic: boolean) => void;
  view: (v: string) => void;
  animate: (
    index: number,
    playing: boolean,
    speed: number,
    time?: number,
  ) => void;
  focus: (uuid: string) => void;
  uv: (canvas: HTMLCanvasElement, channel: number) => void;
  screenshot: () => string;
  convert: () => Promise<any>;
  environment: (a: Asset) => Promise<void>;
}
function disposeObject(object: THREE.Object3D) {
  const textures = new Set<THREE.Texture>(),
    materials = new Set<THREE.Material>();
  object.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.geometry.dispose();
      if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose();
      for (const m of Array.isArray(node.material)
        ? node.material
        : [node.material]) {
        materials.add(m);
        for (const value of Object.values(m))
          if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  textures.forEach((t) => {
    t.dispose();
    const data = t.image;
    if (typeof ImageBitmap !== "undefined" && data instanceof ImageBitmap)
      data.close();
  });
  materials.forEach((m) => m.dispose());
}
export function ModelViewer({
  asset,
  variant = null,
  textures = [],
  compact = false,
  thumbnail = false,
  onReady,
  onCapture,
}: {
  asset: Asset;
  variant?: MaterialVariant | null;
  textures?: Asset[];
  compact?: boolean;
  thumbnail?: boolean;
  onReady?: (info: ModelInfo) => void;
  onCapture?: (image: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    api = useRef<ModelAPI | null>(null),
    readyCallback = useRef(onReady),
    captureCallback = useRef(onCapture);
  readyCallback.current = onReady;
  captureCallback.current = onCapture;
  const [info, setInfo] = useState<ModelInfo | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [active, setActive] = useState(true),
    [loadProgress, setLoadProgress] = useState(""),
    [mode, setMode] = useState("original"),
    [playing, setPlaying] = useState(false),
    [animation, setAnimation] = useState(0),
    [speed, setSpeed] = useState(1),
    [time, setTime] = useState(0),
    [uvOpen, setUVOpen] = useState(false),
    [uvChannel, setUVChannel] = useState(0);
  const uvCanvas = useRef<HTMLCanvasElement>(null),
    texturesRef = useRef(textures);
  texturesRef.current = textures;
  const [environmentPicker, setEnvironmentPicker] = useState(false),
    [environments, setEnvironments] = useState<Asset[]>([]);
  const converted = useRef(false);
  function convertCopy() {
    return api.current
      ?.convert()
      .then(() => useStore.getState().notify("GLB 副本已加入导入任务"));
  }
  useEffect(() => {
    if (info && asset.metadata.convertOnOpen && !converted.current) {
      converted.current = true;
      void convertCopy()?.catch(report);
    }
  }, [info]);
  function modelCommands() {
    const ready = !!info && !loading && !error;
    return [
      c("reset", "重置相机", () => api.current?.reset(), { disabled: !ready }),
      g(
        "view",
        "视角",
        [
          ["orbit", "自由视角"],
          ["front", "正面"],
          ["top", "顶面"],
          ["side", "侧面"],
        ].map(([value, label]) =>
          c(
            value,
            label,
            () =>
              value === "orbit"
                ? api.current?.reset()
                : api.current?.view(value),
            { disabled: !ready },
          ),
        ),
      ),
      g("projection", "投影", [
        c("perspective", "透视", () => api.current?.projection(false), {
          disabled: !ready,
        }),
        c("orthographic", "正交", () => api.current?.projection(true), {
          disabled: !ready,
        }),
      ]),
      g(
        "mode",
        "显示模式",
        [
          ["original", "原始材质"],
          ["wireframe", "线框"],
          ["solid", "纯色"],
          ["normal", "法线"],
          ["uv", "UV 棋盘"],
        ].map(([value, label]) =>
          c(
            value,
            label,
            () => {
              setMode(value);
              api.current?.mode(value);
            },
            { checked: mode === value, disabled: !ready },
          ),
        ),
      ),
      c("uv", "网格与 UV…", () => setUVOpen(!uvOpen), { disabled: !ready }),
      c(
        "hdri",
        "切换 HDRI…",
        async () => {
          const p = await call<any>("assets.query", {
            category: "environment",
            limit: 1000,
          });
          setEnvironments(p.items);
          setEnvironmentPicker(true);
        },
        { disabled: !ready },
      ),
      ...(info?.animations.length
        ? [
            c("animation", playing ? "暂停动画" : "播放动画", () =>
              setPlaying(!playing),
            ),
          ]
        : []),
      c(
        "screenshot",
        "保存截图…",
        () => {
          const value = api.current?.screenshot();
          if (value)
            return call("system.screenshot", { base64: value.split(",")[1] });
        },
        { disabled: !ready },
      ),
      ...([".fbx", ".obj"].includes(asset.extension)
        ? [c("convert", "生成 GLB 副本", convertCopy, { disabled: !ready })]
        : []),
    ];
  }
  // OrbitControls records document key listeners from canvas.getRootNode().
  // Dispose while the canvas is still mounted so it removes the same listeners.
  useLayoutEffect(() => {
    if (!active) return;
    const container = host.current!;
    let disposed = false,
      renderer: THREE.WebGLRenderer,
      root: THREE.Object3D | null = null,
      frame = 0,
      mixer: THREE.AnimationMixer | undefined,
      action: THREE.AnimationAction | undefined,
      clips: THREE.AnimationClip[] = [],
      dirty = true,
      last = performance.now(),
      isPlaying = false,
      animationSpeed = 1,
      lastTimeUI = 0,
      variantGeneration = 0;
    const loadedTextures = new Set<THREE.Texture>(),
      generatedMaterials = new Set<THREE.Material>(),
      modeMaterials = new Set<THREE.Material>(),
      modeTextures = new Set<THREE.Texture>(),
      variantTextures = new Set<THREE.Texture>(),
      variantMaterials = new Set<THREE.Material>(),
      originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>(),
      indices = new Map<THREE.Material, number>(),
      nodes: THREE.Mesh[] = [];
    setLoading(true);
    setError("");
    setInfo(null);
    setMode("original");
    setPlaying(false);
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        preserveDrawingBuffer: true,
        powerPreference: thumbnail ? "low-power" : "high-performance",
      });
    } catch {
      setError("图形加速不可用。仍可浏览缩略图与素材属性。");
      setLoading(false);
      captureCallback.current?.("");
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, thumbnail ? 1 : 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.setClearColor("#20272c");
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene(),
      group = new THREE.Group();
    scene.add(group);
    const perspective = new THREE.PerspectiveCamera(38, 1, 0.001, 10000),
      orthographic = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.001, 10000);
    let camera: THREE.Camera = perspective;
    const controls = new OrbitControls(perspective, renderer.domElement);
    controls.enableDamping = false;
    controls.addEventListener("change", invalidate);
    const pmrem = new THREE.PMREMGenerator(renderer),
      room = new RoomEnvironment(),
      env = pmrem.fromScene(room, 0.04);
    scene.environment = env.texture;
    room.dispose();
    scene.add(new THREE.HemisphereLight("#ffffff", "#26363b", 1.5));
    const key = new THREE.DirectionalLight("#ffffff", 3);
    key.position.set(4, 6, 5);
    scene.add(key);
    const fill = new THREE.DirectionalLight("#9bc6d3", 1);
    fill.position.set(-4, 2, -2);
    scene.add(fill);
    let grid: THREE.GridHelper | undefined,
      center = new THREE.Vector3(),
      radius = 1,
      fit = 3;
    const manager = new THREE.LoadingManager();
    manager.onProgress = (_url, loaded, total) => {
      if (!disposed) setLoadProgress(`资源 ${loaded} / ${total}`);
    };
    manager.setURLModifier((url) => {
      if (/^(?:https?:|file:|ftp:)/i.test(url))
        throw new Error("素材引用了库外资源，请补齐本地依赖");
      if (url.startsWith("workshop:") && asset.metadata.resourceMap) {
        const filename = decodeURIComponent(
            new URL(url).pathname.split("/").at(-1)!,
          ).toLowerCase(),
          mapped = asset.metadata.resourceMap[filename];
        if (mapped) return assetURL(asset.packageId, asset.revisionId, mapped);
      }
      return url;
    });
    manager.addHandler(/\.tga$/i, new TGALoader(manager));
    manager.addHandler(/\.dds$/i, new DDSLoader(manager));
    const draco = new DRACOLoader(manager).setDecoderPath(
        new URL("decoders/draco/", location.href).href,
      ),
      ktx = new KTX2Loader(manager)
        .setTranscoderPath(new URL("decoders/basis/", location.href).href)
        .setWorkerLimit(1);
    ktx.detectSupport(renderer);
    const gltf = new GLTFLoader(manager)
      .setDRACOLoader(draco)
      .setKTX2Loader(ktx)
      .setMeshoptDecoder(MeshoptDecoder);
    function render() {
      if (disposed) return;
      renderer.render(scene, camera);
      dirty = false;
    }
    function invalidate() {
      if (disposed) return;
      dirty = true;
      if (!frame) frame = requestAnimationFrame(loop);
    }
    function reset() {
      camera.position.set(fit, 0.7 * fit, fit);
      controls.target.copy(center);
      controls.update();
      invalidate();
    }
    async function loadTexture(
      url: string,
      slot: TextureSlot,
      channel = "rgb",
    ) {
      const texture = await new THREE.TextureLoader(manager).loadAsync(url);
      loadedTextures.add(texture);
      texture.flipY = false;
      texture.colorSpace = ["baseColor", "emission"].includes(slot)
        ? THREE.SRGBColorSpace
        : THREE.NoColorSpace;
      if (["roughness", "metallic", "ao"].includes(slot)) {
        const image = texture.image as HTMLImageElement,
          canvas = document.createElement("canvas");
        const ratio = Math.min(1, 2048 / Math.max(image.width, image.height));
        canvas.width = Math.max(1, Math.round(image.width * ratio));
        canvas.height = Math.max(1, Math.round(image.height * ratio));
        const context = canvas.getContext("2d", { willReadFrequently: true })!;
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const data = context.getImageData(0, 0, canvas.width, canvas.height);
        const index = { r: 0, g: 1, b: 2, a: 3, rgb: 0 }[channel] ?? 0;
        for (let i = 0; i < data.data.length; i += 4) {
          const v = data.data[i + index];
          data.data[i] = data.data[i + 1] = data.data[i + 2] = v;
          data.data[i + 3] = 255;
        }
        context.putImageData(data, 0, 0);
        const result = new THREE.CanvasTexture(canvas);
        result.flipY = false;
        result.colorSpace = THREE.NoColorSpace;
        loadedTextures.add(result);
        texture.dispose();
        loadedTextures.delete(texture);
        return result;
      }
      return texture;
    }
    async function apply(v: MaterialVariant | null) {
      const generation = ++variantGeneration;
      for (const [mesh, m] of originals) mesh.material = m;
      for (const material of variantMaterials) {
        material.dispose();
        generatedMaterials.delete(material);
      }
      variantMaterials.clear();
      for (const texture of variantTextures) {
        texture.dispose();
        loadedTextures.delete(texture);
      }
      variantTextures.clear();
      if (!v) {
        invalidate();
        return;
      }
      const maps: Partial<Record<TextureSlot, THREE.Texture>> = {};
      for (const [slot, binding] of Object.entries(v.bindings)) {
        const tex =
          texturesRef.current.find((a) => a.id === binding!.assetId) ??
          (await call<any>("assets.detail", { id: binding!.assetId })).asset;
        const t = await loadTexture(
          tex.previewUrl,
          slot as TextureSlot,
          binding!.channel,
        );
        t.channel = binding!.uv;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(...v.repeat);
        t.offset.set(...v.offset);
        t.rotation = v.rotation;
        maps[slot as TextureSlot] = t;
      }
      if (disposed || generation !== variantGeneration) {
        Object.values(maps).forEach((t) => {
          t?.dispose();
          if (t) loadedTextures.delete(t);
        });
        return;
      }
      Object.values(maps).forEach((t) => {
        if (t) variantTextures.add(t);
      });
      for (const [mesh, original] of originals) {
        const update = (source: THREE.Material) => {
          if (
            (indices.get(source) ?? 0) !== v.materialIndex &&
            !asset.metadata.materialSet
          )
            return source;
          if (!(source instanceof THREE.MeshStandardMaterial)) return source;
          const material = source.clone();
          generatedMaterials.add(material);
          variantMaterials.add(material);
          material.color.set(v.baseColor);
          material.roughness = v.roughness;
          material.metalness = v.metallic;
          material.normalScale.set(
            v.normalScale,
            v.normalConvention === "dx" ? -v.normalScale : v.normalScale,
          );
          material.aoMapIntensity = v.aoStrength;
          material.emissive.set(v.emission);
          material.emissiveIntensity = v.emissionStrength;
          material.side = v.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
          material.transparent = v.alphaMode === "BLEND";
          material.alphaTest = v.alphaMode === "MASK" ? v.alphaCutoff : 0;
          if (maps.baseColor) material.map = maps.baseColor;
          if (maps.normal) material.normalMap = maps.normal;
          if (maps.roughness) material.roughnessMap = maps.roughness;
          if (maps.metallic) material.metalnessMap = maps.metallic;
          if (maps.ao) material.aoMap = maps.ao;
          if (maps.emission) material.emissiveMap = maps.emission;
          for (const field of [
            "map",
            "normalMap",
            "roughnessMap",
            "metalnessMap",
            "aoMap",
            "emissiveMap",
          ] as const) {
            const original = material[field];
            if (!original) continue;
            let texture = original;
            if (!Object.values(maps).includes(original)) {
              texture = original.clone();
              material[field] = texture;
              loadedTextures.add(texture);
              variantTextures.add(texture);
            }
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
            texture.repeat.set(...v.repeat);
            texture.offset.set(...v.offset);
            texture.rotation = v.rotation;
            texture.magFilter =
              v.textureFilter === "nearest"
                ? THREE.NearestFilter
                : THREE.LinearFilter;
            texture.minFilter =
              v.textureFilter === "nearest"
                ? THREE.NearestMipmapNearestFilter
                : THREE.LinearMipmapLinearFilter;
            texture.needsUpdate = true;
          }
          material.needsUpdate = true;
          return material;
        };
        mesh.material = Array.isArray(original)
          ? original.map(update)
          : update(original);
      }
      invalidate();
    }
    const onContextLost = (event: Event) => {
      event.preventDefault();
      setActive(false);
      setError("图形上下文已丢失，请重新打开预览");
    };
    renderer.domElement.addEventListener("webglcontextlost", onContextLost);
    const resize = new ResizeObserver(() => {
      if (disposed) return;
      const w = Math.max(container.clientWidth, 1),
        h = Math.max(container.clientHeight, 1);
      renderer.setSize(w, h, false);
      perspective.aspect = w / h;
      perspective.updateProjectionMatrix();
      orthographic.left = (-radius * 2 * w) / h;
      orthographic.right = (radius * 2 * w) / h;
      orthographic.top = radius * 2;
      orthographic.bottom = -radius * 2;
      orthographic.updateProjectionMatrix();
      invalidate();
    });
    resize.observe(container);
    const load = async () => {
      let associations: Map<any, any> | undefined;
      if (asset.capabilities.preview === "environment") {
        const t =
          asset.extension === ".exr"
            ? await new EXRLoader(manager).loadAsync(asset.previewUrl!)
            : await new HDRLoader(manager).loadAsync(asset.previewUrl!);
        loadedTextures.add(t);
        t.mapping = THREE.EquirectangularReflectionMapping;
        scene.environment = t;
        scene.background = t;
        root = new THREE.Mesh(
          new THREE.SphereGeometry(1, 48, 32),
          new THREE.MeshStandardMaterial({ metalness: 1, roughness: 0.15 }),
        );
      } else if ([".dds", ".ktx2"].includes(asset.extension)) {
        const t =
          asset.extension === ".dds"
            ? await new DDSLoader(manager).loadAsync(asset.previewUrl!)
            : await ktx.loadAsync(asset.previewUrl!);
        loadedTextures.add(t);
        t.colorSpace = THREE.SRGBColorSpace;
        root = new THREE.Mesh(
          new THREE.SphereGeometry(1, 48, 32),
          new THREE.MeshStandardMaterial({ map: t, roughness: 0.7 }),
        );
      } else if (asset.metadata.materialSet) {
        const m = new THREE.MeshStandardMaterial({
          roughness: 1,
          metalness: 0,
        });
        const set = asset.metadata.materialSet;
        for (const slot of [
          "baseColor",
          "normal",
          "roughness",
          "metallic",
          "ao",
        ] as TextureSlot[]) {
          if (set[slot]) {
            const t = await loadTexture(
              assetURL(asset.packageId, asset.revisionId, set[slot]),
              slot,
            );
            t.wrapS = t.wrapT = THREE.RepeatWrapping;
            const field = {
              baseColor: "map",
              normal: "normalMap",
              roughness: "roughnessMap",
              metallic: "metalnessMap",
              ao: "aoMap",
            }[slot as "baseColor"];
            (m as any)[field] = t;
            if (slot === "metallic") m.metalness = 1;
          }
        }
        if (set.orm) {
          const t = await new THREE.TextureLoader(manager).loadAsync(
            assetURL(asset.packageId, asset.revisionId, set.orm),
          );
          t.flipY = false;
          loadedTextures.add(t);
          m.aoMap = m.roughnessMap = m.metalnessMap = t;
          m.metalness = 1;
        }
        if (set.normalConvention === "dx") m.normalScale.y = -1;
        root = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), m);
      } else if (asset.extension === ".glb" || asset.extension === ".gltf") {
        const result = await gltf.loadAsync(asset.previewUrl!);
        root = result.scene;
        clips = result.animations;
        associations = result.parser.associations;
      } else if (asset.extension === ".fbx") {
        const loader = new WorkshopFBXLoader(manager);
        root = await loader.loadAsync(
          asset.metadata.animationModel
            ? assetURL(
                asset.packageId,
                asset.revisionId,
                asset.metadata.animationModel,
              )
            : asset.previewUrl!,
        );
        clips = [...root.animations];
        for (const file of asset.metadata.animationFiles ?? []) {
          try {
            const animation = await loader.loadAsync(
              assetURL(asset.packageId, asset.revisionId, file),
            );
            clips.push(
              ...animation.animations.map((c) => {
                c.name = file
                  .split("/")
                  .at(-1)!
                  .replace(/\.fbx$/i, "");
                return c;
              }),
            );
            disposeObject(animation);
          } catch (e) {
            console.warn("动画片段未加载", file, e);
          }
        }
      } else if (asset.extension === ".obj") {
        const loader = new OBJLoader(manager),
          mtl = asset.dependencies.find((p) =>
            p.toLowerCase().endsWith(".mtl"),
          );
        if (mtl) {
          const materials = await new MTLLoader(manager).loadAsync(
            assetURL(asset.packageId, asset.revisionId, mtl),
          );
          materials.preload();
          loader.setMaterials(materials);
        }
        root = await loader.loadAsync(asset.previewUrl!);
      } else throw new Error("此格式需要转换后查看");
      if (disposed) {
        if (root) disposeObject(root);
        return;
      }
      group.add(root!);
      root!.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root!),
        size = box.getSize(new THREE.Vector3()),
        originalCenter = box.getCenter(new THREE.Vector3());
      if (box.isEmpty()) throw new Error("模型没有可查看的几何体");
      group.position.set(-originalCenter.x, -box.min.y, -originalCenter.z);
      center = new THREE.Vector3(0, size.y / 2, 0);
      radius = Math.max(size.length() / 2, 0.01);
      fit = radius * 2.7;
      perspective.near = Math.max(radius / 10000, 0.00001);
      perspective.far = radius * 1000;
      perspective.updateProjectionMatrix();
      orthographic.near = perspective.near;
      orthographic.far = perspective.far;
      if (!thumbnail) {
        grid = new THREE.GridHelper(radius * 5, 12, "#42545c", "#303b42");
        scene.add(grid);
      }
      reset();
      let triangles = 0,
        vertices = 0,
        materialCounter = 0;
      const materialDetails = new Map<number, ModelInfo["materials"][number]>(),
        uvs = new Set<number>();
      root!.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        nodes.push(object);
        originals.set(object, object.material);
        const geometry = object.geometry;
        vertices += geometry.attributes.position?.count ?? 0;
        triangles +=
          (geometry.index?.count ?? geometry.attributes.position?.count ?? 0) /
          3;
        Object.keys(geometry.attributes)
          .filter((k) => /^uv\d*$/.test(k))
          .forEach((k) => uvs.add(k === "uv" ? 0 : Number(k.slice(2)) + 0));
        for (const m of Array.isArray(object.material)
          ? object.material
          : [object.material]) {
          let index = indices.get(m);
          if (index === undefined) {
            index = Number(
              associations?.get(m)?.materials ?? materialCounter++,
            );
            indices.set(m, index);
          }
          const standard = m as THREE.MeshStandardMaterial;
          materialDetails.set(index, {
            index,
            name: m.name || `材质 ${index + 1}`,
            color: standard.color?.getHexString
              ? `#${standard.color.getHexString()}`
              : "#ffffff",
            roughness: standard.roughness ?? 1,
            metallic: standard.metalness ?? 0,
            editable:
              !!standard.isMeshStandardMaterial &&
              !(standard instanceof THREE.MeshPhysicalMaterial) &&
              !standard.userData?.gltfExtensions?.KHR_materials_unlit,
          });
        }
      });
      if (clips.length) mixer = new THREE.AnimationMixer(root!);
      const modelInfo: ModelInfo = {
        triangles: Math.round(triangles),
        vertices,
        uvChannels: [...uvs],
        materials: [...materialDetails.values()].sort(
          (a, b) => a.index - b.index,
        ),
        animations: clips.map((c) => ({ name: c.name, duration: c.duration })),
        nodes: nodes.map((n) => ({
          uuid: n.uuid,
          name: n.name || "未命名网格",
        })),
      };
      setInfo(modelInfo);
      setLoading(false);
      readyCallback.current?.(modelInfo);
      if (asset.extension === ".fbx" || asset.extension === ".obj")
        void call("previews.metadata", {
          assetId: asset.id,
          metadata: {
            triangles: modelInfo.triangles,
            vertices: modelInfo.vertices,
            uvChannels: modelInfo.uvChannels,
            materials: modelInfo.materials,
            animations: modelInfo.animations,
          },
        }).catch(() => {});
      api.current = {
        apply,
        reset,
        mode: (value) => {
          for (const m of modeMaterials) {
            m.dispose();
            generatedMaterials.delete(m);
          }
          modeMaterials.clear();
          for (const t of modeTextures) {
            t.dispose();
            loadedTextures.delete(t);
          }
          modeTextures.clear();
          for (const [mesh, m] of originals) {
            if (value === "original") mesh.material = m;
            else if (value === "wireframe") {
              const wire = new THREE.MeshBasicMaterial({
                color: "#9ec4b5",
                wireframe: true,
              });
              generatedMaterials.add(wire);
              modeMaterials.add(wire);
              mesh.material = wire;
            } else if (value === "normal") {
              const normal = new THREE.MeshNormalMaterial();
              generatedMaterials.add(normal);
              modeMaterials.add(normal);
              mesh.material = normal;
            } else if (value === "solid") {
              const solid = new THREE.MeshStandardMaterial({
                color: "#bac3c4",
                roughness: 0.7,
              });
              generatedMaterials.add(solid);
              modeMaterials.add(solid);
              mesh.material = solid;
            } else {
              const canvas = document.createElement("canvas");
              canvas.width = canvas.height = 256;
              const ctx = canvas.getContext("2d")!;
              for (let y = 0; y < 8; y++)
                for (let x = 0; x < 8; x++) {
                  ctx.fillStyle = (x + y) % 2 ? "#435b5b" : "#d3e6cf";
                  ctx.fillRect(x * 32, y * 32, 32, 32);
                }
              const t = new THREE.CanvasTexture(canvas);
              loadedTextures.add(t);
              modeTextures.add(t);
              const checker = new THREE.MeshBasicMaterial({ map: t });
              generatedMaterials.add(checker);
              modeMaterials.add(checker);
              mesh.material = checker;
            }
          }
          invalidate();
        },
        projection: (orth) => {
          camera = orth ? orthographic : perspective;
          camera.position.copy(controls.object.position);
          controls.object = camera as any;
          controls.update();
          resize.disconnect();
          resize.observe(container);
          invalidate();
        },
        view: (direction) => {
          const p =
            direction === "front"
              ? [0, center.y, fit]
              : direction === "top"
                ? [0, fit, 0.001]
                : [fit, center.y, 0];
          camera.position.set(p[0], p[1], p[2]);
          controls.update();
          invalidate();
        },
        animate: (index, play, s, newTime) => {
          if (!mixer || !clips[index]) return;
          if (action?.getClip() !== clips[index]) {
            action?.stop();
            action = mixer.clipAction(clips[index]);
            action.play();
          }
          isPlaying = play;
          animationSpeed = s;
          if (newTime !== undefined) {
            action!.time = newTime;
            mixer.update(0);
          }
          invalidate();
        },
        focus: (uuid) => {
          const node = nodes.find((n) => n.uuid === uuid);
          nodes.forEach((n) => (n.visible = !uuid || n === node));
          invalidate();
        },
        uv: (canvas, channel) => {
          const ctx = canvas.getContext("2d")!;
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = "#192228";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.strokeStyle = "#78bea5";
          ctx.lineWidth = 0.6;
          for (const mesh of nodes) {
            if (!mesh.visible) continue;
            const geometry = mesh.geometry,
              uv = geometry.getAttribute(channel === 0 ? "uv" : `uv${channel}`);
            if (!uv) continue;
            const count = Math.min(geometry.index?.count ?? uv.count, 90000);
            for (let i = 0; i + 2 < count; i += 3) {
              ctx.beginPath();
              for (let k = 0; k < 3; k++) {
                const j = geometry.index ? geometry.index.getX(i + k) : i + k;
                const x = uv.getX(j) * canvas.width,
                  y = (1 - uv.getY(j)) * canvas.height;
                k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
              }
              ctx.closePath();
              ctx.stroke();
            }
          }
        },
        convert: async () => {
          if (!root) throw new Error("模型尚未加载");
          const displayed = new Map<
            THREE.Mesh,
            THREE.Material | THREE.Material[]
          >();
          for (const [mesh, material] of originals) {
            displayed.set(mesh, mesh.material);
            mesh.material = material;
          }
          let result: ArrayBuffer | object;
          try {
            result = await new GLTFExporter().parseAsync(root, {
              binary: true,
              animations: clips,
              onlyVisible: false,
            });
          } finally {
            for (const [mesh, material] of displayed) mesh.material = material;
            invalidate();
          }
          if (!(result instanceof ArrayBuffer)) throw new Error("GLB 转换失败");
          const raw = new Uint8Array(result);
          let binary = "";
          for (let i = 0; i < raw.length; i += 32768)
            binary += String.fromCharCode(...raw.subarray(i, i + 32768));
          return call("models.fromPreview", {
            assetId: asset.id,
            projectId:
              asset.metadata.conversionProjectId ??
              useStore.getState().query.projectId,
            base64: btoa(binary),
          });
        },
        screenshot: () => {
          render();
          return renderer.domElement.toDataURL("image/png");
        },
        environment: async (a) => {
          const t =
            a.extension === ".exr"
              ? await new EXRLoader(manager).loadAsync(a.previewUrl!)
              : await new HDRLoader(manager).loadAsync(a.previewUrl!);
          if (disposed) {
            t.dispose();
            return;
          }
          loadedTextures.add(t);
          t.mapping = THREE.EquirectangularReflectionMapping;
          scene.environment = t;
          invalidate();
        },
      };
      if (thumbnail) {
        render();
        setTimeout(() => {
          if (!disposed) captureCallback.current?.(api.current!.screenshot());
        }, 100);
      }
    };
    void load().catch((e) => {
      if (!disposed) {
        setError(e.message);
        setLoading(false);
        captureCallback.current?.("");
      }
    });
    function loop(timestamp: number) {
      if (disposed) return;
      frame = 0;
      const delta = Math.min((timestamp - last) / 1000, 0.1);
      last = timestamp;
      if (isPlaying && mixer) {
        mixer.update(delta * animationSpeed);
        if (timestamp - lastTimeUI > 250) {
          lastTimeUI = timestamp;
          setTime(action?.time ?? 0);
        }
        dirty = true;
      }
      if (dirty) render();
      if (isPlaying && !frame) frame = requestAnimationFrame(loop);
    }
    frame = requestAnimationFrame(loop);
    return () => {
      disposed = true;
      manager.abort();
      variantGeneration++;
      api.current = null;
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.removeEventListener("change", invalidate);
      controls.dispose();
      // Three 0.186's global DFG LUT keeps per-context dispose listeners.
      // Release its GPU handles before disposing this renderer; other viewers
      // can upload the immutable shared lookup again on their next render.
      const lookups = new Set<THREE.Texture>();
      for (const material of [
        ...generatedMaterials,
        ...[...originals.values()].flat(),
      ]) {
        const properties = renderer.properties.get(material) as {
          uniforms?: { dfgLUT?: { value?: THREE.Texture } };
        };
        const texture = properties.uniforms?.dfgLUT?.value;
        if (texture instanceof THREE.Texture && texture.name === "DFG_LUT")
          lookups.add(texture);
      }
      lookups.forEach((texture) => texture.dispose());
      mixer?.stopAllAction();
      if (root) {
        for (const [mesh, m] of originals) mesh.material = m;
        disposeObject(root);
      }
      generatedMaterials.forEach((m) => m.dispose());
      loadedTextures.forEach((t) => t.dispose());
      grid?.geometry.dispose();
      if (grid) {
        const materials = Array.isArray(grid.material)
          ? grid.material
          : [grid.material];
        materials.forEach((m) => m.dispose());
      }
      env.dispose();
      pmrem.dispose();
      ktx.dispose();
      draco.dispose();
      renderer.domElement.removeEventListener(
        "webglcontextlost",
        onContextLost,
      );
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [asset.id, asset.revisionId, thumbnail, active]);
  useEffect(() => {
    if (info) void api.current?.apply(variant).catch(report);
  }, [variant, info]);
  useEffect(() => {
    api.current?.animate(animation, playing, speed, playing ? undefined : time);
  }, [animation, playing, speed, time]);
  useEffect(() => {
    if (uvOpen && uvCanvas.current)
      api.current?.uv(uvCanvas.current, uvChannel);
  }, [uvOpen, uvChannel, info]);
  return (
    <div
      className={`model-viewer ${compact ? "compact" : ""} ${thumbnail ? "thumbnail" : ""}`}
      tabIndex={thumbnail ? undefined : 0}
      {...(thumbnail ? {} : menuBindings(modelCommands, true))}
    >
      <div ref={host} className="model-canvas" />
      {loading && (
        <div className="viewer-message">
          <div className="loader-ring" />
          正在加载模型…
          <span>{loadProgress}</span>
          {!thumbnail && (
            <button
              onClick={() => {
                setActive(false);
                setLoading(false);
                setError("预览加载已取消");
              }}
            >
              取消加载
            </button>
          )}
        </div>
      )}
      {error && (
        <div className="viewer-message error">
          <AlertTriangle size={24} />
          <p>{error}</p>
          {!active && (
            <button
              onClick={() => {
                setError("");
                setActive(true);
              }}
            >
              重新加载
            </button>
          )}
        </div>
      )}
      {!thumbnail && !error && (
        <>
          <div className="viewport-label">
            <Box size={13} />
            <span>
              {asset.capabilities.preview === "material"
                ? "材质预览"
                : asset.capabilities.preview === "environment"
                  ? "环境预览"
                  : "3D 预览"}
            </span>
            <span className="viewport-dot" />
          </div>
          {!compact && (
            <>
              <div className="viewport-tools">
                <MoreButton items={modelCommands} label="模型更多操作" />
              </div>
              <div className="viewport-bottom">
                <span>{info?.triangles.toLocaleString() ?? "—"} 三角形</span>
                <span>{info?.vertices.toLocaleString() ?? "—"} 顶点</span>
                <span>UV {info?.uvChannels.join(" / ") || "无"}</span>
              </div>
              {!!info?.animations.length && (
                <div className="animation-controls">
                  <button
                    className="icon-button"
                    aria-label={playing ? "暂停动画" : "播放动画"}
                    onClick={() => setPlaying(!playing)}
                  >
                    {playing ? <Pause size={17} /> : <Play size={17} />}
                  </button>
                  <select
                    value={animation}
                    aria-label="动画"
                    onChange={(e) => {
                      setAnimation(Number(e.target.value));
                      setTime(0);
                    }}
                  >
                    {info.animations.map((c, i) => (
                      <option key={i} value={i}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label="动画时间"
                    type="range"
                    min="0"
                    max={info.animations[animation]?.duration ?? 1}
                    step="0.01"
                    value={time}
                    onChange={(e) => {
                      setTime(Number(e.target.value));
                      setPlaying(false);
                    }}
                  />
                  <select
                    value={speed}
                    aria-label="动画速度"
                    onChange={(e) => setSpeed(Number(e.target.value))}
                  >
                    {[0.25, 0.5, 1, 2].map((s) => (
                      <option key={s} value={s}>
                        {s}×
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}
          {uvOpen && (
            <div className="uv-overlay">
              <header>
                UV 线框
                {info && (
                  <select
                    aria-label="网格显隐"
                    onChange={(e) => {
                      api.current?.focus(e.target.value);
                      if (uvCanvas.current)
                        api.current?.uv(uvCanvas.current, uvChannel);
                    }}
                  >
                    <option value="">全部网格 ({info.nodes.length})</option>
                    {info.nodes.map((n) => (
                      <option key={n.uuid} value={n.uuid}>
                        {n.name}
                      </option>
                    ))}
                  </select>
                )}
                <select
                  value={uvChannel}
                  onChange={(e) => setUVChannel(Number(e.target.value))}
                >
                  {info?.uvChannels.map((c) => (
                    <option value={c} key={c}>
                      UV{c}
                    </option>
                  ))}
                </select>
                <button onClick={() => setUVOpen(false)}>关闭</button>
              </header>
              <canvas ref={uvCanvas} width="400" height="400" />
              {!info?.uvChannels.length && (
                <p>模型缺少 UV，可查看网格但不能进行 UV 贴图绑定。</p>
              )}
            </div>
          )}
        </>
      )}
      {environmentPicker && (
        <Modal
          title="选择 HDRI 环境"
          onClose={() => setEnvironmentPicker(false)}
        >
          <div className="file-list">
            {environments.map((a) => (
              <button
                key={a.id}
                onClick={() =>
                  void api.current
                    ?.environment(a)
                    .then(() => setEnvironmentPicker(false))
                    .catch(report)
                }
              >
                {a.title}
              </button>
            ))}
            {!environments.length && <p>请先导入或下载 HDRI 环境素材。</p>}
          </div>
        </Modal>
      )}
    </div>
  );
}
export function ThumbnailHost() {
  const [asset, setAsset] = useState<Asset | null>(null);
  useEffect(() => {
    const handler = (event: Event) => setAsset((event as CustomEvent).detail);
    window.addEventListener("thumbnail-asset", handler);
    (window as any).thumbnailReady = true;
    return () => window.removeEventListener("thumbnail-asset", handler);
  }, []);
  return asset ? (
    <ModelViewer
      key={`${asset.id}-${asset.metadata.thumbnailToken ?? "initial"}`}
      asset={asset}
      thumbnail
      onCapture={(image) => {
        void call(image ? "previews.thumbnail" : "previews.thumbnailFailed", {
          assetId: asset.id,
          token: asset.metadata.thumbnailToken,
          base64: image.split(",")[1] ?? "",
        }).catch(console.error);
      }}
    />
  ) : null;
}
