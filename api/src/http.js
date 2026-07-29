export function json(body, init = {}) {
  return {
    status: init.status || 200,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {})
    },
    jsonBody: body
  };
}

export function errorResponse(error) {
  const status = error.status || 500;
  return json({
    error: status === 500 ? 'Internal server error' : error.message
  }, { status });
}
