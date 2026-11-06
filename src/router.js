import { createRouter, createWebHistory } from 'vue-router'
import { initializeAuth, useAuth } from './lib/authStore'

const routes = [
  { path: '/login', component: () => import('./pages/LoginPage.vue'), meta: { public: true } },
  { path: '/', redirect: '/activaciones' },
  {
    path: '/activaciones',
    component: () => import('./pages/ActivacionesPage.vue'),
  },
  {
    path: '/impulsadores',
    component: () => import('./pages/ImpulsadoresPage.vue'),
  },
  {
    path: '/metricas',
    component: () => import('./pages/MetricasPage.vue'),
    children: [
      { path: '', redirect: (to) => ({ path: '/metricas/resumen', query: to.query }) },
      { path: 'resumen', component: () => import('./pages/metricas/ResumenTab.vue') },
      { path: 'equipos', component: () => import('./pages/metricas/EquiposTab.vue') },
      { path: 'campo', component: () => import('./pages/metricas/CampoTab.vue') },
    ],
  },
  {
    path: '/usuarios',
    component: () => import('./components/Usuarios.vue'),
    meta: { admin: true },
  },
  {
    path: '/equipos',
    component: () => import('./components/Equipos.vue'),
    meta: { admin: true },
  },
  {
    path: '/plazas',
    component: () => import('./pages/PlazasPage.vue'),
    meta: { admin: true },
  },
  {
    path: '/notificaciones',
    component: () => import('./components/Notificaciones.vue'),
    meta: { admin: true },
  },
  {
    path: '/capacidad',
    component: () => import('./components/Capacidad.vue'),
    meta: { admin: true },
  },
]

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

router.beforeEach(async (to) => {
  await initializeAuth()
  const { profile, isAdmin } = useAuth()
  if (to.meta.public) return profile.value ? '/activaciones' : true
  if (!profile.value) return { path: '/login', query: { redirect: to.fullPath } }
  if (to.meta.admin && !isAdmin.value) return '/activaciones'
  return true
})
