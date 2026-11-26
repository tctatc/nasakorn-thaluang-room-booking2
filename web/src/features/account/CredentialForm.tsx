import { useState, type FormEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import {
  PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, PIN_LENGTH, validateCredentialChangeInput,
} from '@shared/schemas/user';
import { useApp } from '../../app/providers/AppProvider';
import { ApiError } from '../../lib/api/types';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { cn } from '../../lib/cn';

const inputClass = 'min-h-12 w-full rounded-control border border-line bg-surface px-3 text-base text-ink outline-none transition-colors duration-150 focus:border-brand focus:ring-2 focus:ring-brand/20 aria-[invalid=true]:border-danger';
const labelClass = 'mb-1.5 block text-sm font-medium text-ink';

type Field = 'currentPassword' | 'newPassword' | 'confirmPassword' | 'currentPin' | 'newPin' | 'confirmPin';

/**
 * ตั้งรหัสผ่าน และ/หรือ PIN ใหม่ของตัวเอง
 * ต้องใส่ค่าปัจจุบันเสมอ (server ตรวจซ้ำ) — ตอนเข้าครั้งแรกคือค่าที่ผู้ดูแลให้มา
 * สำเร็จแล้วเครื่องนี้ได้ session ใหม่ทันที เครื่องอื่นที่ค้างอยู่ถูกออกจากระบบ
 */
export function CredentialForm({
  password, pin, firstTime = false, formId, onDone, hideSubmit = false,
}: {
  password: boolean;
  pin: boolean;
  /** ตั้งครั้งแรกหลังผู้ดูแลสร้างบัญชี/รีเซ็ต — เปลี่ยนคำอธิบายช่อง "ค่าปัจจุบัน" */
  firstTime?: boolean;
  formId: string;
  onDone: () => void;
  /** ปุ่มบันทึกอยู่ข้างนอก (เช่นท้าย Dialog) ผูกด้วย form={formId} */
  hideSubmit?: boolean;
}) {
  const { api, token, adoptSession } = useApp();
  const [values, setValues] = useState<Record<Field, string>>({
    currentPassword: '', newPassword: '', confirmPassword: '', currentPin: '', newPin: '', confirmPin: '',
  });
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const set = (field: Field, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };
  const digits = (value: string) => value.replace(/\D/g, '').slice(0, PIN_LENGTH);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const input = {
      currentPassword: password ? values.currentPassword : '',
      newPassword: password ? values.newPassword : '',
      currentPin: pin ? values.currentPin : '',
      newPin: pin ? values.newPin : '',
    };
    const parsed = validateCredentialChangeInput(input, { password, pin });
    const found: Partial<Record<Field, string>> = {};
    if (!parsed.ok) for (const issue of parsed.issues) found[issue.field as Field] ??= issue.message;
    if (password && !found.newPassword && values.confirmPassword !== values.newPassword) found.confirmPassword = 'รหัสผ่านใหม่สองช่องไม่ตรงกัน';
    if (pin && !found.newPin && values.confirmPin !== values.newPin) found.confirmPin = 'PIN ใหม่สองช่องไม่ตรงกัน';
    setErrors(found);
    setFailure(null);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    api.changeOwnCredentials(token, input)
      .then((result) => adoptSession(result))
      .then(onDone)
      .catch((cause: unknown) => {
        if (cause instanceof ApiError && cause.issues.length > 0) {
          const fromServer: Partial<Record<Field, string>> = {};
          for (const issue of cause.issues) fromServer[issue.field as Field] ??= issue.message;
          setErrors(fromServer);
        }
        setFailure(cause instanceof Error ? cause.message : 'บันทึกไม่สำเร็จ');
      })
      .finally(() => setBusy(false));
  };

  const field = (name: Field, label: string, options: { kind: 'password' | 'pin'; autoComplete: string; help?: string }) => (
    <div>
      <label className={labelClass} htmlFor={`${formId}-${name}`}>{label}</label>
      <input
        id={`${formId}-${name}`}
        className={cn(inputClass, options.kind === 'pin' && 'tabular-nums tracking-[0.3em]')}
        type={show ? 'text' : 'password'}
        inputMode={options.kind === 'pin' ? 'numeric' : undefined}
        maxLength={options.kind === 'pin' ? PIN_LENGTH : PASSWORD_MAX_LENGTH}
        autoComplete={options.autoComplete}
        autoCapitalize="none" spellCheck={false}
        value={values[name]}
        onChange={(event) => set(name, options.kind === 'pin' ? digits(event.target.value) : event.target.value)}
        aria-invalid={errors[name] ? true : undefined}
        aria-describedby={errors[name] ? `${formId}-${name}-error` : options.help ? `${formId}-${name}-help` : undefined}
      />
      {errors[name]
        ? <p id={`${formId}-${name}-error`} className="mt-1 text-sm font-medium text-danger">{errors[name]}</p>
        : options.help && <p id={`${formId}-${name}-help`} className="mt-1 text-sm text-ink-muted">{options.help}</p>}
    </div>
  );

  return (
    <form id={formId} onSubmit={submit} noValidate className="space-y-5">
      {failure !== null && <Alert tone="danger" title="บันทึกไม่สำเร็จ"><span role="alert">{failure}</span></Alert>}

      {password && (
        <fieldset className="space-y-4">
          {pin && <legend className="mb-3 text-base font-semibold text-ink">รหัสผ่าน</legend>}
          {field('currentPassword', firstTime ? 'รหัสผ่านที่ได้รับจากผู้ดูแล' : 'รหัสผ่านปัจจุบัน', { kind: 'password', autoComplete: 'current-password' })}
          {field('newPassword', 'รหัสผ่านใหม่', { kind: 'password', autoComplete: 'new-password', help: `อย่างน้อย ${PASSWORD_MIN_LENGTH} ตัว มีทั้งตัวอักษรภาษาอังกฤษและตัวเลข` })}
          {field('confirmPassword', 'พิมพ์รหัสผ่านใหม่อีกครั้ง', { kind: 'password', autoComplete: 'new-password' })}
        </fieldset>
      )}

      {pin && (
        <fieldset className={cn('space-y-4', password && 'border-t border-line pt-5')}>
          {password && <legend className="sr-only">PIN</legend>}
          {password && <p aria-hidden="true" className="text-base font-semibold text-ink">PIN {PIN_LENGTH} หลัก</p>}
          {field('currentPin', firstTime ? 'PIN ที่ได้รับจากผู้ดูแล' : 'PIN ปัจจุบัน', { kind: 'pin', autoComplete: 'off' })}
          {field('newPin', 'PIN ใหม่', { kind: 'pin', autoComplete: 'off', help: 'ใช้เข้าสู่ระบบแบบเร็ว และยืนยันตอนลงนาม ห้ามเลขซ้ำหรือเลขเรียง เช่น 111111, 123456' })}
          {field('confirmPin', 'พิมพ์ PIN ใหม่อีกครั้ง', { kind: 'pin', autoComplete: 'off' })}
        </fieldset>
      )}

      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink">
        <input type="checkbox" className="size-5 accent-brand" checked={show} onChange={(event) => setShow(event.target.checked)} />
        {show ? <EyeOff className="size-4 text-ink-muted" aria-hidden="true" /> : <Eye className="size-4 text-ink-muted" aria-hidden="true" />}
        แสดงสิ่งที่พิมพ์
      </label>

      {!hideSubmit && <Button type="submit" fullWidth size="lg" loading={busy} loadingLabel="กำลังบันทึก">บันทึก</Button>}
      {hideSubmit && busy && <p className="sr-only" role="status">กำลังบันทึก</p>}
    </form>
  );
}
