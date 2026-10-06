import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { normalizeFBX } from "../../../shared/fbx";

export class WorkshopFBXLoader extends FBXLoader {
  override parse(buffer: ArrayBuffer, path: string) {
    return super.parse(normalizeFBX(buffer), path);
  }
}
