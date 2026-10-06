import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Box3, Mesh, Vector3 } from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { WorkshopFBXLoader } from "../src/renderer/src/viewers/WorkshopFBXLoader";
import { normalizeFBX } from "../src/shared/fbx";

const fixture = fs.readFileSync(
  path.resolve("tests/fixtures/kenney-nature/bridge_center_wood.fbx"),
);
function buffer(text: string) {
  return new TextEncoder().encode(text).buffer;
}
function checkBridge(data: ArrayBuffer) {
  const root = new WorkshopFBXLoader().parse(data, "");
  const meshes: Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof Mesh) meshes.push(object);
  });
  expect(meshes).toHaveLength(1);
  const geometry = meshes[0].geometry;
  expect(geometry.attributes.position.count).toBe(156);
  expect(geometry.attributes.normal.count).toBe(156);
  expect(geometry.attributes.uv.count).toBe(156);
  for (const attribute of Object.values(geometry.attributes))
    expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
  expect(geometry.groups).toEqual([
    { start: 0, count: 138, materialIndex: 0 },
    { start: 138, count: 12, materialIndex: 1 },
    { start: 150, count: 6, materialIndex: 2 },
  ]);
  const materials = meshes[0].material;
  expect(Array.isArray(materials)).toBe(true);
  expect(
    (materials as any[]).map((m) => [m.name, m.color.getHexString()]),
  ).toEqual([
    ["woodBark", "e28357"],
    ["wood", "ff8e62"],
    ["stone", "b8e2e8"],
  ]);
  const box = new Box3().setFromObject(root);
  expect(box.getSize(new Vector3()).toArray()).toEqual([10, 3, 10]);
  root.traverse((object) => {
    if (object instanceof Mesh) {
      object.geometry.dispose();
      for (const m of Array.isArray(object.material)
        ? object.material
        : [object.material])
        m.dispose();
    }
  });
}

describe("FBX compatibility", () => {
  test("real Kenney bridge retains all triangles, indexed UVs and three material groups", () => {
    const data = fixture.buffer.slice(
      fixture.byteOffset,
      fixture.byteOffset + fixture.byteLength,
    );
    // Reproduce the upstream failure, then validate the actual geometry, not
    // just the absence of an exception (the trailing array comma also matters).
    expect(() => new FBXLoader().parse(data, "")).toThrow("reading 'a'");
    checkBridge(data);
    expect(
      fs.readFileSync("tests/fixtures/kenney-nature/bridge_center_wood.fbx"),
    ).toEqual(fixture);
  });

  test("spaces, CRLF, wrapped arrays and terminal commas preserve geometry", () => {
    const wrapped = fixture
      .toString("utf8")
      .replace(
        /(\s+a:\s*)([^\r\n]+)/g,
        (_match, prefix: string, values: string) => {
          const split = values.split(",");
          return (
            prefix +
            split.slice(0, 5).join(",") +
            ",\r\n    " +
            split.slice(5).join(",")
          );
        },
      )
      .replace(/^\t+/gm, (indent) => "  ".repeat(indent.length));
    checkBridge(buffer("\uFEFF" + wrapped));
  });

  test("quoted braces, semicolons and escaped quotes are data, not structure", () => {
    const text =
      '; comment {\nFBXVersion: 7300\nNode: 1, "path;{\\\"}.png", "Mesh" {\n    FileName: "纹理/{木材};.png"\n      Values: *3 {\n a: 1,2,\n    3, ; array comment }\n        }\n }\n';
    const normalized = new TextDecoder().decode(normalizeFBX(buffer(text)));
    expect(normalized).toContain('\tFileName: "纹理/{木材};.png"');
    expect(normalized).toContain('Node: 1, "path;{\\\"}.png", "Mesh" {');
    expect(normalized).toContain("\t\ta: 1,2,\n3\n\t}");
  });

  test("binary files pass through exactly, and incomplete ASCII does not acquire fabricated data", () => {
    const binary = buffer(
      "Kaydara FBX Binary  \0\x1a\0" + "FBXVersion: 7400\n{",
    );
    expect(normalizeFBX(binary)).toBe(binary);
    const other = buffer("not an FBX");
    expect(normalizeFBX(other)).toBe(other);
    expect(() =>
      normalizeFBX(buffer("FBXVersion: 7300\nObjects: {\n")),
    ).toThrow("括号结构不完整");
  });

  test("real binary character and separate animation retain the skeleton and tracks", () => {
    const parsed = ["Model/characterMedium.fbx", "Animations/idle.fbx"].map(
      (file) => {
        const b = fs.readFileSync(
          path.resolve("tests/fixtures/kenney-animated", file),
        );
        const data = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
        expect(normalizeFBX(data)).toBe(data);
        return new WorkshopFBXLoader().parse(data, "");
      },
    );
    let skinned = 0;
    parsed[0].traverse((node: any) => {
      if (node.isSkinnedMesh) {
        skinned++;
        expect(node.skeleton.bones.length).toBeGreaterThan(0);
        expect(node.geometry.attributes.skinIndex.count).toBe(
          node.geometry.attributes.position.count,
        );
        node.skeleton.dispose();
        node.geometry.dispose();
        (Array.isArray(node.material)
          ? node.material
          : [node.material]
        ).forEach((m: any) => m.dispose());
      }
    });
    expect(skinned).toBe(1);
    expect(parsed[1].animations).toHaveLength(2);
    expect(parsed[1].animations[0].tracks).toHaveLength(138);
    expect(parsed[1].animations[0].duration).toBeCloseTo(1.0666667);
  });
});
