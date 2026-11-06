// @ts-check

/**
 * Row of /portal/metrics/activations. Only the fields the dashboard reads are listed.
 * @typedef {object} Activacion
 * @property {string} [id]
 * @property {string} [usuario_id]
 * @property {string} [impulsador]
 * @property {string | null} [fecha_activacion]
 * @property {string | null} [created_at]
 * @property {string | null} [ciudad_activacion]
 * @property {string | null} [tipo_activacion] Subtype shown in the app (comercio, limbo, transeunte, …).
 * @property {string | null} [base_activacion] Group shown in the app (tienda_barrio, comercio, transeunte, cliente_antiguo).
 * @property {string | null} [tipo_comercio]
 * @property {string | null} [tipo_tienda]
 * @property {string | null} [nombre_comercio]
 * @property {string | null} [comercio]
 * @property {string | null} [cliente]
 * @property {string | null} [nombres_cliente]
 * @property {string | null} [lider_id_registro] Leader snapshot at registration time.
 * @property {string | null} [lider_nombre_registro]
 * @property {string | null} [equipo_id_registro]
 * @property {string | number | null} [equipo_numero_registro]
 * @property {string | null} [equipo_nombre_registro]
 * @property {boolean | null} [cash_in]
 * @property {boolean | null} [hubo_error]
 * @property {number | string | null} [latitud]
 * @property {number | string | null} [longitud]
 */

/**
 * Row of /portal/users (authorized catalog).
 * @typedef {object} Usuario
 * @property {string} usuario_id
 * @property {string} [nombre]
 * @property {string} [rol]
 * @property {string[]} [roles]
 * @property {string} [estado]
 * @property {string | null} [lider_id]
 * @property {string | null} [lider_nombre]
 * @property {string | null} [equipo_id]
 * @property {string | number | null} [equipo_numero]
 * @property {string | null} [equipo_nombre]
 */

/**
 * @typedef {object} Filtros
 * @property {string} desde YYYY-MM-DD or ''.
 * @property {string} hasta YYYY-MM-DD or ''.
 * @property {string} plaza Key `pkey:<clave>` / 'none' or ''.
 * @property {string} activador Key `uid:<id>` / 'none' or ''.
 * @property {string} tipo Normalized tipo key or ''.
 * @property {string} lider Key `lid:<id>` or ''.
 * @property {string} equipo Key `id:|num:|name:` or ''.
 */

/**
 * Today in America/La_Paz.
 * @typedef {object} Hoy
 * @property {string} todayKey YYYY-MM-DD
 * @property {string} monthKey YYYY-MM
 * @property {string} weekStartKey Monday of the current week, YYYY-MM-DD.
 */

/**
 * @typedef {object} Opcion
 * @property {string} key
 * @property {string} nombre
 */

/**
 * @typedef {object} Conteo
 * @property {string} key
 * @property {string} label
 * @property {number} value
 */

/**
 * @typedef {object} EstadisticaActivador
 * @property {number} value
 * @property {Set<string>} dias Distinct days with at least one activation (Salidas).
 * @property {number} comercios
 */

/**
 * @typedef {object} FilaRanking
 * @property {string} key
 * @property {string} label
 * @property {number} value
 * @property {number} salidas
 * @property {number} comercios
 */
