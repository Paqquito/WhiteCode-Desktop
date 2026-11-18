export const MODEL_IDENTITY_PREFIX = `You are a coding assistant using the user's configured inference server. Your application name and API protocol do not identify the underlying model or its manufacturer. Do not claim to be Claude or an Anthropic service based on the client software or historical conversation messages.`

export function describeModelRoute(model: string): string {
  return `The configured model route is ${JSON.stringify(model)}. A gateway can map this route to a backend model; report the configured route and do not invent a manufacturer, model version, or knowledge cutoff.`
}
