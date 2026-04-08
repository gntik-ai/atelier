const env = ((import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {}) as Record<
  string,
  string | undefined
>

function readEnv(key: string, fallback: string): string {
  const value = env[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback
}

export const consoleAuthConfig = {
  realm: readEnv('VITE_CONSOLE_AUTH_REALM', 'in-falcone-platform'),
  clientId: readEnv('VITE_CONSOLE_AUTH_CLIENT_ID', 'in-falcone-console'),
  loginPath: readEnv('VITE_CONSOLE_AUTH_LOGIN_PATH', '/login'),
  signupPath: readEnv('VITE_CONSOLE_AUTH_SIGNUP_PATH', '/signup'),
  pendingActivationPath: readEnv('VITE_CONSOLE_AUTH_PENDING_ACTIVATION_PATH', '/signup/pending-activation'),
  passwordRecoveryPath: readEnv('VITE_CONSOLE_AUTH_PASSWORD_RECOVERY_PATH', '/password-recovery'),
  headings: {
    title: readEnv('VITE_CONSOLE_AUTH_TITLE', 'Accede a In Falcone Console'),
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
    ),
    signupTitle: readEnv('VITE_CONSOLE_SIGNUP_TITLE', 'Crea tu acceso a In Falcone Console'),
    signupSubtitle: readEnv(
      'VITE_CONSOLE_SIGNUP_SUBTITLE',
      'Registro público respaldado por Keycloak y gobernado por la policy efectiva de /v1/auth/signups/policy.'
    ),
    signupSubmit: readEnv('VITE_CONSOLE_SIGNUP_SUBMIT_LABEL', 'Crear solicitud de acceso'),
    signupSubmitLoading: readEnv('VITE_CONSOLE_SIGNUP_SUBMIT_LOADING_LABEL', 'Enviando registro…'),
    displayName: readEnv('VITE_CONSOLE_SIGNUP_DISPLAY_NAME_LABEL', 'Nombre visible'),
    primaryEmail: readEnv('VITE_CONSOLE_SIGNUP_EMAIL_LABEL', 'Correo principal'),
    pendingActivationTitle: readEnv(
      'VITE_CONSOLE_PENDING_ACTIVATION_TITLE',
      'Tu registro está pendiente de activación'
    )
  }
} as const

export type ConsoleAuthConfig = typeof consoleAuthConfig
