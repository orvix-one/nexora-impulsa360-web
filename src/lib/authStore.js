// Auth state driven only by Supabase auth events; the profile is loaded once per signed-in user.
import { computed, readonly, ref } from 'vue'
import { apiRequest, configureApi } from './api'
import { supabase } from './supabaseClient'

const session = ref(null)
const profile = ref(null)
const loading = ref(true)
const accessError = ref('')
const isAdmin = computed(() => profile.value?.roles?.includes('administrador') === true)
let initialization
let profileLoad = Promise.resolve()

configureApi({
  current: () => session.value?.access_token ?? null,
  refresh: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
})

async function loadProfile(token) {
  try {
    profile.value = (await apiRequest('/portal/me', { token })).profile
    accessError.value = ''
  } catch (error) {
    profile.value = null
    accessError.value = error.message
  }
}

async function applySession(nextSession) {
  const sameUser = nextSession?.user?.id === session.value?.user?.id
  session.value = nextSession
  if (!nextSession) {
    profile.value = null
    return
  }
  if (sameUser && profile.value) return
  profile.value = null
  await loadProfile(nextSession.access_token)
}

export function initializeAuth() {
  initialization ??= new Promise((resolve) => {
    supabase.auth.onAuthStateChange((_event, nextSession) => {
      profileLoad = applySession(nextSession)
      profileLoad.finally(() => {
        loading.value = false
        resolve()
      })
    })
  })
  return initialization
}

export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  await profileLoad
  if (!profile.value) {
    const reason = accessError.value || 'Acceso no autorizado.'
    await supabase.auth.signOut()
    accessError.value = reason
    throw new Error(reason)
  }
}

export async function signOut() {
  await supabase.auth.signOut()
  session.value = null
  profile.value = null
}

export function useAuth() {
  return {
    session: readonly(session),
    profile: readonly(profile),
    loading: readonly(loading),
    accessError: readonly(accessError),
    isAdmin,
  }
}
