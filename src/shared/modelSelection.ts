import type { GatewayModel } from '#desktop/model-provider'

export const LEGACY_MODEL = /^(claude[-.]|(?:sonnet|opus|haiku)(?:\[.*\])?$|opusplan$)/i

/** Old Claude aliases are not model selections in this application. */
export function savedModel(value: unknown): string | null {
  return typeof value === 'string' && value.trim() && !LEGACY_MODEL.test(value.trim())
    ? value.trim()
    : null
}

/** Models of a server catalogue that can be selected. */
export function catalogModels(models: GatewayModel[]): GatewayModel[] {
  return models.filter(model => !LEGACY_MODEL.test(model.id))
}

/** Shared by the selector and the process that sends the request. */
export function selectedGatewayModel(models: GatewayModel[], selected: string | null): GatewayModel | null {
  return models.find(model => model.id === savedModel(selected))
    ?? models.find(model => model.isDefault)
    ?? models[0]
    ?? null
}
