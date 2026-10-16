// -----------------------------------------------------------------------------
// Texts shown in Gladys (connection status, button, transport badges, feature
// names, option labels), in English and French.
// -----------------------------------------------------------------------------

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const list = (names) => names.map((n) => `"${n}"`).join(', ');
const minutes = (ms) => Math.max(1, Math.round(ms / 60_000));
const seconds = (ms) => Math.max(1, Math.round(ms / 1000));

/** The name of each source in the messages. */
export const SOURCES = {
  airstage: { en: 'Airstage cloud', fr: 'Cloud Airstage' },
  local: { en: 'Airstage Wi-Fi adapters', fr: 'Adaptateurs Wi-Fi Airstage' },
  fglair: { en: 'FGLair cloud', fr: 'Cloud FGLair' },
};

/** Joins the parts of a message, each { en, fr }. */
export const join = (parts) => ({
  en: parts.map((p) => p.en).join(' '),
  fr: parts.map((p) => p.fr).join(' '),
});

export const T = {
  notConfigured: {
    en: 'Fill in your Airstage or FGLair account (e-mail and password of the app), or the list of your Airstage Wi-Fi adapters, then save.',
    fr: 'Renseignez votre compte Airstage ou FGLair (e-mail et mot de passe de l’application), ou la liste de vos adaptateurs Wi-Fi Airstage, puis enregistrez.',
  },
  incomplete: (source) => ({
    en: `${SOURCES[source].en}: the e-mail or the password is missing.`,
    fr: `${SOURCES[source].fr} : il manque l’e-mail ou le mot de passe.`,
  }),
  localInvalid: (entries) => ({
    en: `Adapter entries not understood (an address and a MAC address are needed): ${list(entries)}.`,
    fr: `Entrées d’adaptateurs non comprises (il faut une adresse et une adresse MAC) : ${list(entries)}.`,
  }),
  connecting: {
    en: 'Connecting to Fujitsu…',
    fr: 'Connexion à Fujitsu…',
  },
  units: (source, count) => ({
    en: `${SOURCES[source].en}: ${plural(count, 'unit', 'units')}.`,
    fr: `${SOURCES[source].fr} : ${plural(count, 'appareil', 'appareils')}.`,
  }),
  noUnit: (source) => ({
    en: `${SOURCES[source].en}: connected, but this account has no air conditioner. Is it the account of the ${source === 'fglair' ? 'FGLair' : 'Airstage'} app?`,
    fr: `${SOURCES[source].fr} : connecté, mais ce compte n’a aucun climatiseur. Est-ce bien le compte de l’application ${source === 'fglair' ? 'FGLair' : 'Airstage'} ?`,
  }),
  adapters: (up, total) => ({
    en: `${SOURCES.local.en}: ${up} of ${total} reachable.`,
    fr: `${SOURCES.local.fr} : ${up} sur ${total} joignable${up > 1 ? 's' : ''}.`,
  }),
  refused: (source) => ({
    en: `${SOURCES[source].en}: the e-mail or the password was refused. Check them in the app, then save the configuration (not retried on its own).`,
    fr: `${SOURCES[source].fr} : l’e-mail ou le mot de passe a été refusé. Vérifiez-les dans l’application, puis enregistrez la configuration (pas de nouvel essai automatique).`,
  }),
  rateLimited: (source, ms) => ({
    en: `${SOURCES[source].en}: too many requests, next attempt in ${minutes(ms)} min.`,
    fr: `${SOURCES[source].fr} : trop de requêtes, nouvel essai dans ${minutes(ms)} min.`,
  }),
  unreachable: (source, reason, ms) => ({
    en: `${SOURCES[source].en}: unreachable (${reason}), next attempt in ${seconds(ms)} s.`,
    fr: `${SOURCES[source].fr} : injoignable (${reason}), nouvel essai dans ${seconds(ms)} s.`,
  }),
  addThem: {
    en: 'Open Discovery to add the units.',
    fr: 'Ouvrez Découverte pour ajouter les appareils.',
  },
  badge: {
    localDown: {
      en: 'Wi-Fi adapter unreachable: through the Airstage cloud',
      fr: 'Adaptateur Wi-Fi injoignable : via le cloud Airstage',
    },
    cloudDown: {
      en: 'Airstage cloud unavailable: through the Wi-Fi adapter',
      fr: 'Cloud Airstage indisponible : via l’adaptateur Wi-Fi',
    },
  },
  test: {
    ok: (source, names) =>
      names.length === 0
        ? {
            en: `${SOURCES[source].en}: sign-in OK, but no air conditioner on this account.`,
            fr: `${SOURCES[source].fr} : connexion OK, mais aucun climatiseur sur ce compte.`,
          }
        : {
            en: `${SOURCES[source].en}: sign-in OK, ${plural(names.length, 'unit', 'units')} (${list(names)}).`,
            fr: `${SOURCES[source].fr} : connexion OK, ${plural(names.length, 'appareil', 'appareils')} (${list(names)}).`,
          },
    refused: (source) => ({
      en: `${SOURCES[source].en}: the e-mail or the password was refused.`,
      fr: `${SOURCES[source].fr} : l’e-mail ou le mot de passe a été refusé.`,
    }),
    rateLimited: (source) => ({
      en: `${SOURCES[source].en}: too many requests, try again in a few minutes.`,
      fr: `${SOURCES[source].fr} : trop de requêtes, réessayez dans quelques minutes.`,
    }),
    failed: (source, reason) => ({
      en: `${SOURCES[source].en}: no answer as expected (${reason}).`,
      fr: `${SOURCES[source].fr} : pas de réponse correcte (${reason}).`,
    }),
    adapterOk: (address, model) => ({
      en: `Adapter ${address}: OK${model ? ` (${model})` : ''}.`,
      fr: `Adaptateur ${address} : OK${model ? ` (${model})` : ''}.`,
    }),
    adapterFailed: (address, reason) => ({
      en: `Adapter ${address}: no answer (${reason}).`,
      fr: `Adaptateur ${address} : pas de réponse (${reason}).`,
    }),
  },
};

const position = {
  en: (k, n) => `Position ${k}${k === 1 ? ' (top)' : k === n ? ' (bottom)' : ''}`,
  fr: (k, n) => `Position ${k}${k === 1 ? ' (haut)' : k === n ? ' (bas)' : ''}`,
};

/** Device texts, in the language chosen in the configuration. */
const TEXTS = {
  en: {
    features: {
      binary: 'On/off',
      mode: 'Mode',
      'target-temperature': 'Setpoint',
      'fan-speed': 'Fan speed',
      'swing-vertical': 'Vertical swing',
      'vertical-position': 'Vertical position',
      'swing-horizontal': 'Horizontal swing',
      economy: 'Economy',
      powerful: 'Powerful',
      'outdoor-low-noise': 'Outdoor unit low noise',
      'energy-saving-fan': 'Energy saving fan',
      'minimum-heat': 'Minimum heat (10 °C)',
      'indoor-temperature': 'Indoor temperature',
      'outdoor-temperature': 'Outdoor temperature',
      'error-code': 'Error code',
    },
    options: {
      mode: { AUTO: 'Auto', COOL: 'Cool', HEAT: 'Heat', DRY: 'Dry', FAN: 'Fan' },
      fan: {
        AUTO: 'Auto',
        QUIET: 'Quiet',
        LOW: 'Low',
        MEDIUM_LOW: 'Medium low',
        MEDIUM: 'Medium',
        MEDIUM_HIGH: 'Medium high',
        HIGH: 'High',
      },
      swing: { OFF: 'Off', SWING: 'Swing' },
      position: position.en,
    },
    unit: 'Fujitsu air conditioner',
  },
  fr: {
    features: {
      binary: 'Marche/arrêt',
      mode: 'Mode',
      'target-temperature': 'Consigne',
      'fan-speed': 'Ventilation',
      'swing-vertical': 'Balayage vertical',
      'vertical-position': 'Position verticale',
      'swing-horizontal': 'Balayage horizontal',
      economy: 'Économie',
      powerful: 'Puissance (Powerful)',
      'outdoor-low-noise': 'Unité extérieure silencieuse',
      'energy-saving-fan': 'Ventilation économique',
      'minimum-heat': 'Hors-gel (10 °C)',
      'indoor-temperature': 'Température intérieure',
      'outdoor-temperature': 'Température extérieure',
      'error-code': 'Code d’erreur',
    },
    options: {
      mode: {
        AUTO: 'Auto',
        COOL: 'Froid',
        HEAT: 'Chaud',
        DRY: 'Déshumidification',
        FAN: 'Ventilation',
      },
      fan: {
        AUTO: 'Auto',
        QUIET: 'Silencieux',
        LOW: 'Faible',
        MEDIUM_LOW: 'Moyenne basse',
        MEDIUM: 'Moyenne',
        MEDIUM_HIGH: 'Moyenne haute',
        HIGH: 'Forte',
      },
      swing: { OFF: 'Arrêt', SWING: 'Balayage' },
      position: position.fr,
    },
    unit: 'Climatiseur Fujitsu',
  },
};

export const texts = (language) => TEXTS[language] ?? TEXTS.en;
