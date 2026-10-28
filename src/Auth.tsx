import { useState } from 'react';
import { ArrowRight, Mail, ShieldCheck } from 'lucide-react';
import { Field, Mascot, Modal } from './ui';
import { api } from './store';
import type { User } from './types';
export default function Auth({
  onClose,
  onLogin,
}: {
  onClose: () => void;
  onLogin: (user: User) => void;
}) {
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal
      title={register ? '给你的安排，一个家' : '又见面了'}
      description="独立账号，无需 ChatGPT。登录同一账号，可在手机和电脑间同步。"
      onClose={onClose}
    >
      <div className="auth-art">
        <Mascot size={90} />
        <span>
          重要的事，
          <br />
          <strong>我们慢慢完成。</strong>
        </span>
      </div>
      <form
        className="form-stack"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          try {
            const result = await api<{ user: User }>(
              register ? '/api/auth/register' : '/api/auth/login',
              { email, password, ...(register ? { name } : {}) },
            );
            onLogin(result.user);
          } catch (e) {
            setError(e instanceof Error ? e.message : '连接失败，请稍后再试。');
          } finally {
            setBusy(false);
          }
        }}
      >
        {register && (
          <Field label="怎么称呼你">
            <input
              required
              maxLength={40}
              autoComplete="nickname"
              placeholder="你的名字"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
        )}
        <Field label="邮箱">
          <input
            required
            type="email"
            maxLength={254}
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field
          label="密码"
          hint={register ? '至少 10 位。尚未开通邮件找回，请妥善保管。' : undefined}
        >
          <input
            required
            type="password"
            minLength={10}
            maxLength={128}
            autoComplete={register ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="输入你的密码"
          />
        </Field>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <button disabled={busy} className="button primary full-width" type="submit">
          <Mail size={18} />
          {busy ? '正在连接…' : register ? '注册并开始安排' : '登录奇遇 DDL'}
          <ArrowRight size={18} />
        </button>
      </form>
      <p className="auth-switch">
        {register ? '已经有账号了？' : '第一次来到这里？'}
        <button
          className="text-button"
          onClick={() => {
            setRegister((v) => !v);
            setError('');
          }}
        >
          {register ? '直接登录' : '创建账号'}
        </button>
      </p>
      <div className="auth-note">
        <ShieldCheck size={16} />
        <span>当前支持邮箱与密码。手机号验证码尚未接通。</span>
      </div>
    </Modal>
  );
}
