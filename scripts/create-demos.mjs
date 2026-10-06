import fs from "node:fs/promises";
import path from "node:path";
export async function createDemos(call, waitJob) {
  const list = (
      await call("assets.query", {
        showRelated: true,
        category: "texture",
        limit: 1000,
      })
    ).items,
    models = (
      await call("assets.query", {
        extension: "gltf",
        search: "wooden_crate",
        limit: 100,
      })
    ).items;
  const crate = models.find((a) => a.extension === ".gltf");
  if (!crate) throw new Error("请先安装真实示例");
  const textures = list.filter((a) => a.source?.assetId === "WoodFloor051"),
    wood = textures.find((a) => a.metadata.materialSet);
  if (!wood) throw new Error("木地板材质未安装");
  const common = {
    id: "",
    assetId: crate.id,
    revisionId: crate.revisionId,
    materialIndex: 0,
    bindings: {},
    baseColor: "#ffffff",
    roughness: 1,
    metallic: 0,
    normalScale: 1,
    normalConvention: "gl",
    aoStrength: 1,
    emission: "#000000",
    emissionStrength: 1,
    alphaMode: "OPAQUE",
    alphaCutoff: 0.5,
    doubleSided: false,
    repeat: [1, 1],
    offset: [0, 0],
    rotation: 0,
    createdAt: "",
  };
  const binding = (slot) => {
    const a = textures.find((a) => a.path === wood.metadata.materialSet[slot]);
    if (!a) return undefined;
    return {
      assetId: a.id,
      revisionId: a.revisionId,
      channel: slot === "baseColor" || slot === "normal" ? "rgb" : "r",
      uv: 0,
    };
  };
  const maps = Object.fromEntries(
    ["baseColor", "normal", "roughness", "metallic", "ao"]
      .map((s) => [s, binding(s)])
      .filter(([, b]) => b),
  );
  let variants = await call("materials.list", { assetId: crate.id });
  for (const [name, color, roughness] of [
    ["秋季木箱 · 暖木色", "#ba804b", 0.7],
    ["旧木箱 · 哑光", "#9a9689", 1],
  ])
    if (!variants.some((v) => v.name === name))
      variants.push(
        await call("materials.save", {
          ...common,
          name,
          baseColor: color,
          roughness,
          normalConvention: wood.metadata.materialSet.normalConvention ?? "gl",
          bindings: maps,
        }),
      );
  let materialVariants = await call("materials.list", { assetId: wood.id });
  if (!materialVariants.length)
    materialVariants = [
      await call("materials.save", {
        ...common,
        assetId: wood.id,
        revisionId: wood.revisionId,
        name: "木地板 · 平铺材质",
        normalConvention: wood.metadata.materialSet.normalConvention ?? "gl",
        bindings: maps,
        repeat: [2, 2],
      }),
    ];
  const dirs = {
    two: path.resolve("examples/godot-2d"),
    three: path.resolve("examples/godot-3d"),
  };
  for (const [key, dir] of Object.entries(dirs)) {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "project.godot"),
      `config_version=5\n\n[application]\nconfig/name="素材工坊 ${key === "two" ? "2D 地牢" : "3D 材质"}示例"\nrun/main_scene="res://main.tscn"\n\n[display]\nwindow/size/viewport_width=1152\nwindow/size/viewport_height=720\n\n[rendering]\nrenderer/rendering_method="gl_compatibility"\ntextures/default_filters/use_nearest_mipmap_filter=false\n`,
    );
  }
  const sprites = (
    await call("assets.query", { category: "sprite", limit: 1000 })
  ).items;
  const sprite =
    sprites.find(
      (a) =>
        a.source?.assetId === "tiny-dungeon" &&
        /tilemap|spritesheet/i.test(a.path),
    ) ?? sprites.find((a) => a.source?.assetId === "tiny-dungeon");
  const ui = (
    await call("assets.query", { category: "ui", limit: 1000 })
  ).items.find((a) => a.extension === ".png" && /panel|button/i.test(a.path));
  const hero = (
      await call("assets.query", {
        hasAnimation: true,
        extension: "glb",
        limit: 100,
      })
    ).items[0],
    hdri = (await call("assets.query", { category: "environment", limit: 1 }))
      .items[0];
  const exportPlan = async (assetIds, target, variantIds = []) =>
    waitJob(
      await call("exports.start", {
        planId: (
          await call("exports.inspect", {
            assetIds,
            target,
            mode: "godot",
            variantIds,
          })
        ).id,
      }),
    );
  const two = await exportPlan([sprite.id, ...(ui ? [ui.id] : [])], dirs.two);
  const three = await exportPlan(
    [crate.id, wood.id, ...(hero ? [hero.id] : []), ...(hdri ? [hdri.id] : [])],
    dirs.three,
    [...variants.map((v) => v.id), ...materialVariants.map((v) => v.id)],
  );
  const relative = (dir, out, entry) =>
    "res://" +
    path.relative(dir, path.join(out.target, entry)).replaceAll("\\", "/");
  const tilePath = relative(
    dirs.two,
    two,
    two.entries.find((e) => e.assetId === sprite.id).entry,
  );
  await fs.writeFile(
    path.join(dirs.two, "main.gd"),
    `extends Control\nfunc _ready():\n var title=Label.new()\n title.text="素材工坊 · 2D 地牢素材 / 原始像素图集"\n title.position=Vector2(40,28)\n title.add_theme_font_size_override("font_size",24)\n add_child(title)\n var image=TextureRect.new()\n image.texture=load("${tilePath}")\n image.texture_filter=CanvasItem.TEXTURE_FILTER_NEAREST\n image.position=Vector2(40,100)\n image.size=Vector2(1000,560)\n image.expand_mode=TextureRect.EXPAND_IGNORE_SIZE\n image.stretch_mode=TextureRect.STRETCH_KEEP_ASPECT_CENTERED\n add_child(image)\n`,
  );
  await fs.writeFile(
    path.join(dirs.two, "main.tscn"),
    '[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://main.gd" id="1"]\n[node name="DungeonAssets" type="Control"]\nlayout_mode=3\nanchors_preset=15\nanchor_right=1.0\nanchor_bottom=1.0\nscript=ExtResource("1")\n',
  );
  const crateEntry = three.entries.find((e) => e.assetId === crate.id),
    original = relative(dirs.three, three, crateEntry.entry),
    variantPaths = crateEntry.variants.map((v) =>
      relative(dirs.three, three, v.path),
    ),
    heroPath = hero
      ? relative(
          dirs.three,
          three,
          three.entries.find((e) => e.assetId === hero.id).entry,
        )
      : null,
    materialPath = relative(
      dirs.three,
      three,
      three.entries.find((e) => e.assetId === wood.id).variants[0].path,
    );
  await fs.writeFile(
    path.join(dirs.three, "main.gd"),
    `extends Node3D\nfunc _ready():\n var camera=Camera3D.new()\n add_child(camera)\n camera.position=Vector3(3,3,6)\n camera.look_at(Vector3(0,0.7,0))\n camera.current=true\n var light=DirectionalLight3D.new()\n light.rotation_degrees=Vector3(-45,-25,0)\n light.light_energy=2.0\n add_child(light)\n var environment=WorldEnvironment.new()\n environment.environment=Environment.new()\n environment.environment.background_mode=Environment.BG_COLOR\n environment.environment.background_color=Color(0.12,0.15,0.13)\n environment.environment.ambient_light_source=Environment.AMBIENT_SOURCE_COLOR\n environment.environment.ambient_light_color=Color(0.7,0.75,0.7)\n environment.environment.ambient_light_energy=0.7\n add_child(environment)\n var model_paths=${JSON.stringify([original, ...variantPaths])}\n for i in range(model_paths.size()):\n  var model=load(model_paths[i]).instantiate()\n  model.position.x=(i-1)*1.8\n  add_child(model)\n var floor=MeshInstance3D.new()\n floor.mesh=PlaneMesh.new()\n floor.mesh.size=Vector2(12,8)\n floor.material_override=load("${materialPath}")\n add_child(floor)\n${heroPath ? ` var hero=load("${heroPath}").instantiate()\n hero.position=Vector3(0,0,-2)\n add_child(hero)\n var player=hero.find_child("AnimationPlayer",true,false)\n if player and player.get_animation_list().size()>0:\n  player.play(player.get_animation_list()[0])\n` : ""}`,
  );
  await fs.writeFile(
    path.join(dirs.three, "main.tscn"),
    '[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://main.gd" id="1"]\n[node name="MaterialWorkshop" type="Node3D"]\nscript=ExtResource("1")\n',
  );
  for (const dir of Object.values(dirs)) {
    await fs.writeFile(
      path.join(dir, "verify.gd"),
      `extends SceneTree\nfunc _initialize():\n var manifest=JSON.parse_string(FileAccess.get_file_as_string("res://assets/workshop/workshop-export.json"))\n var count=0\n for entry in manifest.entries:\n  var resource=load("res://assets/workshop/"+entry.entry)\n  if resource==null:\n   push_error("Missing resource: "+entry.entry)\n   quit(1)\n   return\n  if resource is PackedScene:\n   var node=resource.instantiate()\n   node.free()\n  count+=1\n  for variant in entry.variants:\n   if load("res://assets/workshop/"+variant.path)==null:\n    push_error("Missing variant")\n    quit(1)\n    return\n   count+=1\n print("WORKSHOP_VERIFIED "+str(count))\n quit(0)\n`,
    );
  }
  await fs.writeFile(
    "docs/godot-exports.json",
    JSON.stringify({ two, three }, null, 2),
  );
  console.log("Godot demos", dirs);
  return dirs;
}
