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

export function validationError(message: string) {
  return errorResponse("VALIDATION_ERROR", message, 400);
}
