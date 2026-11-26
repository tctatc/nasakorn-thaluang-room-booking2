import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { SystemSettings } from '@shared/schemas/settings';
import { createApiClient, type ApiClient } from '../../lib/api/client';
import { readAppConfig, type AppConfig } from '../../lib/api/config';
import { ApiError, type BootstrapResult, type LoginResult, type SessionUser } from '../../lib/api/types';
import { readLocal, removeLocal, writeLocal } from '../../lib/storage';

const TOKEN_KEY = 'mrb.session.token';
/**
 * ผลเข้าระบบครั้งล่าสุด (ชื่อ สิทธิ์ ค่าตั้งค่า) — เปิดเว็บครั้งหน้าแสดงหน้าได้ทันที ไม่ต้องรอ server 2–4 วินาที
 * แล้วค่อยตรวจกับ server เบื้องหลัง ถ้า session ใช้ไม่ได้แล้วจะออกจากระบบเอง
 * สิทธิ์ที่เก็บไว้มีผลแค่หน้าตา — ทุกคำสั่ง server ตรวจสิทธิ์จริงอีกครั้งเสมอ
 */
const BOOT_KEY = 'mrb.boot.v1';
/** ผูกกับ token ด้วยส่วนท้าย — token เปลี่ยน (เข้าระบบใหม่/บัญชีอื่น) ข้อมูลเก่าใช้ไม่ได้ */
const tokenTag = (token: string) => token.slice(-16);

function readCachedBoot(token: string): BootstrapResult | null {
  try {
    const saved = JSON.parse(readLocal(BOOT_KEY) ?? 'null') as { tag?: string; boot?: BootstrapResult } | null;
    return saved?.tag === tokenTag(token) && saved.boot?.user && saved.boot.settings ? saved.boot : null;
  } catch {
    return null;
  }
}

type Phase = 'booting' | 'anonymous' | 'ready';

interface AppState {
  config: AppConfig;
  api: ApiClient;
  /** โหมดสาธิต = ข้อมูลอยู่ในหน่วยความจำเบราว์เซอร์ ไม่ใช่ข้อมูลจริง */
  isDemo: boolean;
  phase: Phase;
  user: SessionUser | null;
  token: string;
  settings: SystemSettings | null;
  serverTime: Date | null;
  dataVersion: number;
  bootError: string | null;
  signInWithPassword(username: string, password: string): Promise<void>;
  signInWithPin(pin: string): Promise<void>;
  /** ใช้ session ใหม่ที่ server ออกให้ (หลังเปลี่ยนรหัสผ่าน/PIN ของตัวเอง) */
  adoptSession(result: LoginResult): Promise<void>;
  /** อัปเดตข้อมูลผู้ใช้ปัจจุบันหลังแก้โปรไฟล์ */
  replaceUser(user: SessionUser): void;
  signOut(): void;
  retryBoot(): void;
}

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const config = useMemo(readAppConfig, []);

  /*
   * เข้าโหมดสาธิตเมื่อ (ก) ผู้ใช้ขอเองด้วย ?demo=1 หรือ (ข) ยังไม่ได้ตั้งค่า server
   * กรณี (ข) สำคัญ: เปิดเว็บจาก GitHub Pages ก่อนตั้งค่าเสร็จ ต้องได้เห็นหน้าตาระบบ
   * พร้อมข้อความบอกตรง ๆ ว่ายังไม่เชื่อมต่อ ไม่ใช่เจอหน้าขาวหรือ error ดิบ ๆ
   */
  const isDemo = config.isDemoRequested || !config.isConnected;

  const api = useMemo(
    () => createApiClient({ apiUrl: config.apiUrl, demo: isDemo }),
    [config.apiUrl, isDemo],
  );

  const [phase, setPhase] = useState<Phase>('booting');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [token, setToken] = useState('');
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [serverTime, setServerTime] = useState<Date | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [bootError, setBootError] = useState<string | null>(null);
  const [bootAttempt, setBootAttempt] = useState(0);

  const applyBootstrap = useCallback(
    (result: {
      user: SessionUser;
      settings: SystemSettings;
      dataVersion: number;
      serverTime: string;
    }) => {
      setUser(result.user);
      setSettings(result.settings);
      setDataVersion(result.dataVersion);
      setServerTime(new Date(result.serverTime));
      setBootError(null);
      setPhase('ready');
    },
    [],
  );

  // ทั้งระบบจริงและโหมดข้อมูลในเบราว์เซอร์ใช้ session ที่เก็บไว้ ไม่มีก็ไปหน้าเข้าสู่ระบบ
  useEffect(() => {
    const token = readLocal(TOKEN_KEY);
    if (token === null) {
      setToken('');
      setPhase('anonymous');
      return;
    }

    let cancelled = false;
    // มีผลครั้งก่อน: แสดงหน้าเลย แล้วตรวจกับ server ตามหลัง
    const cached = readCachedBoot(token);
    // เวลาของ server ในผลเก่าอาจเป็นเมื่อวาน — ใช้เวลาเครื่องไปก่อนจนกว่าผลใหม่มาถึง
    if (cached) { setToken(token); applyBootstrap({ ...cached, serverTime: new Date().toISOString() }); } else setPhase('booting');

    api
      .bootstrap(token)
      .then((result) => {
        if (cancelled) return;
        writeLocal(BOOT_KEY, JSON.stringify({ tag: tokenTag(token), boot: result }));
        setToken(token);
        applyBootstrap(result);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && (error.requiresLogin || error.code === 'FORBIDDEN')) {
          removeLocal(TOKEN_KEY);
          removeLocal(BOOT_KEY);
          setToken('');
          setUser(null);
          setPhase('anonymous');
          return;
        }
        // เครือข่ายมีปัญหาแต่มีข้อมูลครั้งก่อน: ใช้งานต่อได้ คำสั่งที่ส่งไปจะแจ้งข้อผิดพลาดเอง
        if (cached) return;
        setBootError(
          error instanceof Error ? error.message : 'เชื่อมต่อระบบไม่สำเร็จ',
        );
        setPhase('anonymous');
      });

    return () => {
      cancelled = true;
    };
  }, [api, isDemo, applyBootstrap, bootAttempt]);

  // ยังไม่เข้าสู่ระบบ: ผู้จองทั่วไปยังต้องใช้กฎการจอง (เวลาทำการ ความยาวขั้นต่ำ) ในฟอร์ม
  useEffect(() => {
    if (phase !== 'anonymous' || settings !== null) return;
    let cancelled = false;
    api.publicBootstrap()
      .then((result) => {
        if (cancelled) return;
        setSettings(result.settings);
        setDataVersion(result.dataVersion);
        setServerTime(new Date(result.serverTime));
      })
      .catch((error: unknown) => {
        if (!cancelled) setBootError(error instanceof Error ? error.message : 'เชื่อมต่อระบบไม่สำเร็จ');
      });
    return () => { cancelled = true; };
  }, [api, phase, settings, bootAttempt]);

  const startSession = useCallback(
    async (result: LoginResult) => {
      const boot = await api.bootstrap(result.token);
      writeLocal(TOKEN_KEY, result.token);
      writeLocal(BOOT_KEY, JSON.stringify({ tag: tokenTag(result.token), boot }));
      setToken(result.token);
      applyBootstrap(boot);
    },
    [api, applyBootstrap],
  );
  const signInWithPassword = useCallback(
    async (username: string, password: string) => startSession(await api.login(username, password)),
    [api, startSession],
  );
  const signInWithPin = useCallback(async (pin: string) => startSession(await api.loginPin(pin)), [api, startSession]);

  const replaceUser = useCallback((next: SessionUser) => {
    setUser(next);
    // เก็บผลที่แก้แล้วไว้ด้วย ไม่งั้นเปิดเว็บครั้งหน้าจะเห็นค่าเก่าแวบหนึ่ง
    const token = readLocal(TOKEN_KEY);
    const cached = token === null ? null : readCachedBoot(token);
    if (token !== null && cached) writeLocal(BOOT_KEY, JSON.stringify({ tag: tokenTag(token), boot: { ...cached, user: next } }));
  }, []);

  const signOut = useCallback(() => {
    removeLocal(TOKEN_KEY);
    removeLocal(BOOT_KEY);
    setToken('');
    setUser(null);
    setSettings(null);
    setPhase('anonymous');
  }, []);

  const retryBoot = useCallback(() => {
    setBootError(null);
    setBootAttempt((count) => count + 1);
  }, []);

  const value = useMemo<AppState>(
    () => ({
      config,
      api,
      isDemo,
      phase,
      user,
      token,
      settings,
      serverTime,
      dataVersion,
      bootError,
      signInWithPassword,
      signInWithPin,
      adoptSession: startSession,
      replaceUser,
      signOut,
      retryBoot,
    }),
    [
      config,
      api,
      isDemo,
      phase,
      user,
      token,
      settings,
      serverTime,
      dataVersion,
      bootError,
      signInWithPassword,
      signInWithPin,
      startSession,
      replaceUser,
      signOut,
      retryBoot,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const context = useContext(AppContext);
  if (context === null) throw new Error('useApp ต้องอยู่ภายใน AppProvider');
  return context;
}

/** สำหรับส่วนที่ใช้ได้ทั้งในและนอกแอป (เช่นแผ่นแบบฟอร์มที่พิมพ์) — นอก AppProvider ได้ null */
export function useOptionalApp(): AppState | null {
  return useContext(AppContext);
}

/** ใช้ในหน้าที่ต้องล็อกอินแล้วเท่านั้น — การ์ดหน้าเว็บรับประกันว่ามีผู้ใช้แล้ว */
export function useCurrentUser(): SessionUser {
  const { user } = useApp();
  if (user === null) throw new Error('ยังไม่มีผู้ใช้ที่เข้าสู่ระบบ');
  return user;
}

export function useSettings(): SystemSettings {
  const { settings } = useApp();
  if (settings === null) throw new Error('ยังไม่ได้โหลดค่าตั้งค่าระบบ');
  return settings;
}
