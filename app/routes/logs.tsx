import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { checkAuth } from "~/lib/check-auth";
import { prisma } from "~/lib/prisma.server";
import { badRequest, internalServerError, unauthorized } from "~/lib/responses";

export const loader = async ({ request }: LoaderFunctionArgs) => {
	await checkAuth(request);

	const url = new URL(request.url);
	const type = url.searchParams.get("type");
	const lastTime = Number(url.searchParams.get("timestamp__lt"));
	const appId = url.searchParams.get("appId");
	const query = url.searchParams.get("query") || "";
	const timeRange = url.searchParams.get("timeRange") || "45d";
	const maxDate = url.searchParams.get("maxDate")
		? new Date(url.searchParams.get("maxDate") || "")
		: new Date();

	if (!appId) {
		throw badRequest({ detail: "Missing appId" });
	}

	let timestampGte: Date;
	if (timeRange === "48h") {
		timestampGte = new Date(Date.now() - 48 * 60 * 60 * 1000);
	} else {
		timestampGte = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
	}

	timestampGte = maxDate < timestampGte ? maxDate : timestampGte;

	switch (type) {
		case "request": {
			const logs = await prisma.requestLog.findMany({
				where: {
					timestamp: {
						lt: new Date(lastTime),
						gte: timestampGte,
					},
					appId,
					...(query && {
						OR: [
							{ method: { contains: query, mode: "insensitive" } },
							{ path: { contains: query, mode: "insensitive" } },
							{ sessionId: { contains: query, mode: "insensitive" } },
						],
					}),
				},
				orderBy: { timestamp: "desc" },
				take: 100,
				omit: { meta: true },
			});

			return { logs };
		}

		case "app": {
			const logs = await prisma.appLog.findMany({
				where: {
					timestamp: {
						lt: new Date(lastTime),
						gte: timestampGte,
					},
					appId,
					...(query && {
						message: { contains: query, mode: "insensitive" },
					}),
				},
				orderBy: { timestamp: "desc" },
				take: 100,
				omit: { meta: true },
			});

			return { logs };
		}
	}

	return {};
};

export const action = async ({ request }: ActionFunctionArgs) => {
	const formData = await request.json();
	const token = request.headers.get("Authorization");

	if (token !== process.env.APP_TOKEN) {
		throw unauthorized({ detail: "Missing Authorization" });
	}

	const { type, ...data } = formData;

	try {
		switch (type) {
			case "request": {
				const parsed = requestLogSchema.parse(data);
				await prisma.requestLog.create({
					data: {
						...parsed,
						timestamp: new Date(parsed.timestamp),
					},
				});
				break;
			}

			case "app": {
				const parsed = appLogSchema.parse(data);
				await prisma.appLog.create({
					data: {
						...parsed,
						timestamp: new Date(parsed.timestamp),
					},
				});
				break;
			}

			default:
				return badRequest({ detail: "Invalid log type" });
		}
	} catch (error) {
		if (error instanceof z.ZodError) {
			throw badRequest({
				detail: error.errors.map((e) => ({
					field: e.path.join("."),
					message: e.message,
				})),
			});
		}

		console.error(error);
		throw internalServerError({ detail: "Invalid log data" });
	}

	return { success: true };
};

const requestLogSchema = z.object({
	appId: z.string(),
	method: z.string(),
	path: z.string(),
	status: z.number(),
	timestamp: z.date().or(z.number()),
	duration: z.number().optional(),
	sessionId: z.string().optional(),
	meta: z.record(z.any()).optional(),
});

const appLogSchema = z.object({
	appId: z.string(),
	level: z.enum(["info", "error", "warn"]),
	message: z.string(),
	timestamp: z.date().or(z.number()),
	duration: z.number().optional(),
	sessionId: z.string().optional(),
	meta: z.record(z.any()).optional(),
});
