export function errorResponse(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}

export function notFound() {
  return errorResponse("ROOM_NOT_FOUND", "Room not found or expired", 404);
}

export function notCreator() {
  return errorResponse("NOT_CREATOR", "Only the room creator can perform this action", 403);
}

export function invalidStatus(message: string) {
  return errorResponse("INVALID_STATUS", message, 400);
}

/** Whether a D1 error is a UNIQUE-constraint violation (a duplicate submission or a lost race). */
export function isUniqueViolation(e: unknown): boolean {
  return String((e as Error)?.message ?? e).includes("UNIQUE");
}

export function validationError(message: string) {
  return errorResponse("VALIDATION_ERROR", message, 400);
}
