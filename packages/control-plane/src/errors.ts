export type ControlPlaneErrorCode =
  | 'CONTROL_PLANE_UNAVAILABLE'
  | 'CONTROL_PLANE_VERSION_CONFLICT'
  | 'CONTROL_PLANE_INVALID'
  | 'CONTROL_PLANE_FORBIDDEN'
  | 'CONTROL_PLANE_POLICY_DENIED'
  | 'CONTROL_PLANE_NOT_FOUND';

export class ControlPlaneError extends Error {
  constructor(
    public readonly code: ControlPlaneErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ControlPlaneError';
  }
}
