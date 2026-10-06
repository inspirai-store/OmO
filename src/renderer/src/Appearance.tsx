import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  builtinSkins,
  defaultAppearance,
  type AppearancePreferences,
  type SkinDefinition,
} from "../../shared/skins";
import { Theme, LoadingState } from "./ui-kit";
import { call, report } from "./store";
export interface AppearanceSnapshot {
  preferences: AppearancePreferences;
  skin: SkinDefinition;
  warning?: string;
}
const initial = { preferences: defaultAppearance, skin: builtinSkins[0] };
const Context = createContext({
  ...initial,
  apply: async (_patch: Partial<AppearancePreferences>) => {},
});
export const useAppearance = () => useContext(Context);
export async function preloadSkin(skin: SkinDefinition) {
  await Promise.all(
    Object.values(skin.urls).map(
      (url) =>
        new Promise<void>((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve();
          image.onerror = () => reject(new Error("皮肤图片无法加载"));
          image.src = url;
        }),
    ),
  );
}
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<AppearanceSnapshot>(initial),
    [ready, setReady] = useState(false);
  const sequence = useRef(0),
    intent = useRef(0),
    pending = useRef(0),
    desired = useRef(initial.preferences),
    current = useRef(snapshot);
  current.current = snapshot;
  useEffect(() => {
    let mounted = true;
    const receive = async (value: AppearanceSnapshot) => {
      // An earlier persistence event must not cancel a newer local selection.
      if (pending.current) return;
      const token = ++sequence.current;
      try {
        await preloadSkin(value.skin);
        if (!mounted || pending.current || token !== sequence.current) return;
        current.current = value;
        desired.current = value.preferences;
        setSnapshot(value);
        if (value.warning) report(new Error(value.warning));
      } catch (e) {
        report(e);
      } finally {
        if (mounted) setReady(true);
      }
    };
    void call<AppearanceSnapshot>("appearance.get")
      .then(receive)
      .catch((e) => {
        report(e);
        setReady(true);
      });
    const off = window.workshop.onEvent((event) => {
      if (event.type === "appearance.changed") void receive(event.data);
    });
    return () => {
      mounted = false;
      off();
    };
  }, []);
  const apply = async (patch: Partial<AppearancePreferences>) => {
    const token = ++intent.current,
      preferences = { ...desired.current, ...patch };
    pending.current = token;
    desired.current = preferences;
    ++sequence.current;
    try {
      const skin = await call<SkinDefinition>("skins.get", {
        key: preferences.skinKey,
      });
      await preloadSkin(skin);
      if (token !== intent.current) return;
      const value = await call<AppearanceSnapshot>(
        "appearance.update",
        preferences,
      );
      if (token !== intent.current) return;
      current.current = value;
      desired.current = value.preferences;
      pending.current = 0;
      setSnapshot(value);
    } catch (error) {
      if (token === intent.current) {
        pending.current = 0;
        desired.current = current.current.preferences;
      }
      throw error;
    }
  };
  return (
    <Context.Provider value={{ ...snapshot, apply }}>
      <Theme
        skin={snapshot.skin}
        density={snapshot.preferences.density}
        motion={snapshot.preferences.motion}
        style={{ display: "contents" }}
      >
        {ready ? children : <LoadingState text="正在载入外观…" />}
      </Theme>
    </Context.Provider>
  );
}
