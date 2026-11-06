// src/errors.ts
function errorDetails(error) {
	if (error === null || typeof error !== "object" && typeof error !== "function") return {};
	const value = error;
	return {
		...typeof value.message === "string" ? { message: value.message } : {},
		...typeof value.code === "string" ? { code: value.code } : {}
	};
}
export { errorDetails };

//# sourceMappingURL=errors.js.map