const env = ((import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {}) as Record<
  string,
  string | undefined
>

function readEnv(key: string, fallback: string): string {
  const value = env[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback
}

export const consoleAuthConfig = {
  realm: readEnv('VITE_CONSOLE_AUTH_REALM', 'in-atelier-platform'),
  clientId: readEnv('VITE_CONSOLE_AUTH_CLIENT_ID', 'in-atelier-console'),
  loginPath: readEnv('VITE_CONSOLE_AUTH_LOGIN_PATH', '/login'),
  signupPath: readEnv('VITE_CONSOLE_AUTH_SIGNUP_PATH', '/signup'),
  passwordRecoveryPath: readEnv('VITE_CONSOLE_AUTH_PASSWORD_RECOVERY_PATH', '/password-recovery'),
  headings: {
    title: readEnv('VITE_CONSOLE_AUTH_TITLE', 'Accede a In Atelier Console'),
    subtitle: readEnv(
      'VITE_CONSOLE_AUTH_SUBTITLE',
      'Autenticación respaldada por Keycloak y normalizada por la familia pública /v1/auth/* del control plane.'
    )
  },
  labels: {
    username: readEnv('VITE_CONSOLE_AUTH_USERNAME_LABEL', 'Usuario'),
    password: readEnv('VITE_CONSOLE_AUTH_PASSWORD_LABEL', 'Contraseña'),
    rememberMe: readEnv('VITE_CONSOLE_AUTH_REMEMBER_ME_LABEL', 'Mantener la sesión abierta en este dispositivo'),
    submit: readEnv('VITE_CONSOLE_AUTH_SUBMIT_LABEL', 'Entrar a la consola'),
    submitLoading: readEnv('VITE_CONSOLE_AUTH_SUBMIT_LOADING_LABEL', 'Validando acceso…'),
    passwordRecovery: readEnv('VITE_CONSOLE_AUTH_PASSWORD_RECOVERY_LABEL', '¿Olvidaste tu contraseña?'),
    signup: readEnv('VITE_CONSOLE_AUTH_SIGNUP_LABEL', 'Solicita acceso o crea tu cuenta'),
    signupDisabled: readEnv(
      'VITE_CONSOLE_AUTH_SIGNUP_DISABLED_LABEL',
      'El auto-registro no está disponible actualmente para este entorno.'
    )
  }
} as const

export type ConsoleAuthConfig = typeof consoleAuthConfig
