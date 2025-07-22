import { Retries } from "durable-utils";
import { KeapClient } from "./keap-client";
import { syncKeapOrders } from "./keap-sync";

export type Env = {
  DB01: D1Database;
  KEAP_SERVICE_ACCOUNT_KEY: string;
};

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);

    // A. Create the Session.
    // When we create a D1 Session, we can continue where we left off from a previous
    // Session if we have that Session's last bookmark or use a constraint.
    const bookmark =
      request.headers.get("x-d1-bookmark") ?? "first-unconstrained";
    const session = env.DB01.withSession(bookmark);

    try {
      // Use this Session for all our Workers' routes.
      const response = await withTablesInitialized(
        request,
        session,
        env,
        handleRequest,
      );

      // B. Return the bookmark so we can continue the Session in another request.
      response.headers.set("x-d1-bookmark", session.getBookmark() ?? "");

      return response;
    } catch (e) {
      console.error({
        message: "Failed to handle request",
        error: String(e),
        errorProps: e,
        url,
        bookmark,
      });
      return Response.json(
        { error: String(e), errorDetails: e },
        { status: 500 },
      );
    }
  },
} satisfies ExportedHandler<Env>;

type Order = {
  orderId: string;
  customerId: string;
  quantity: number;
};

async function handleRequest(request: Request, session: D1DatabaseSession, env: Env) {
  const { pathname } = new URL(request.url);

  const tsStart = Date.now();

  if (request.method === "GET" && pathname === "/api/orders") {
    // C. Session read query.
    return await Retries.tryWhile(async () => {
      const resp = await session.prepare("SELECT * FROM ns_orders ORDER BY orderDate DESC").all();
      return Response.json(buildResponse(session, resp, tsStart));
    }, shouldRetry);
  } else if (request.method === "POST" && pathname === "/api/orders") {
    // This endpoint is now deprecated - use /api/sync-keap-orders instead
    return Response.json(
      { error: "This endpoint is deprecated. Use POST /api/sync-keap-orders to sync orders from Keap." },
      { status: 410 }
    );
  } else if (request.method === "POST" && pathname === "/api/reset") {
    return await Retries.tryWhile(async () => {
      const resp = await resetTables(session);
      return Response.json(buildResponse(session, resp, tsStart));
    }, shouldRetry);
  } else if (request.method === "POST" && pathname === "/api/sync-keap-orders") {
    const keapClient = new KeapClient({
      serviceAccountKey: env.KEAP_SERVICE_ACCOUNT_KEY,
    });

    const syncResult = await syncKeapOrders(session, keapClient);
    
    return Response.json({
      ...buildResponse(session, { results: [], meta: {} } as any, tsStart),
      syncResult,
    });
  } else if (request.method === "GET" && pathname === "/api/keap-orders") {
    // Fetch orders directly from Keap API
    const keapClient = new KeapClient({
      serviceAccountKey: env.KEAP_SERVICE_ACCOUNT_KEY,
    });

    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get("limit") || "20");
    const offset = parseInt(url.searchParams.get("offset") || "0");

    try {
      const { orders, count } = await keapClient.getOrders(limit, offset);
      return Response.json({ orders, count });
    } catch (error) {
      return Response.json(
        { error: `Failed to fetch orders from Keap: ${String(error)}` },
        { status: 500 }
      );
    }
  }

  return new Response("Not found", { status: 404 });
}

function buildResponse(
  session: D1DatabaseSession,
  res: D1Result,
  tsStart: number,
) {
  return {
    d1Latency: Date.now() - tsStart,

    results: res.results,
    servedByRegion: res.meta.served_by_region ?? "",
    servedByPrimary: res.meta.served_by_primary ?? "",

    // Add the session bookmark inside the response body too.
    sessionBookmark: session.getBookmark(),
  };
}

function shouldRetry(err: unknown, nextAttempt: number) {
  const errMsg = String(err);
  const isRetryableError =
    errMsg.includes("Network connection lost") ||
    errMsg.includes("storage caused object to be reset") ||
    errMsg.includes("reset because its code was updated");
  if (nextAttempt <= 5 && isRetryableError) {
    return true;
  }
  return false;
}

/**
 * This is mostly for DEMO purposes to avoid having to do separate schema migrations step.
 * This will check if the error is because our main table is missing, and if it is create the table
 * and rerun the handler.
 */
async function withTablesInitialized(
  request: Request,
  session: D1DatabaseSession,
  env: Env,
  handler: (request: Request, session: D1DatabaseSession, env: Env) => Promise<Response>,
) {
  // We use clones of the body since if we parse it once, and then retry with the
  // same request, it will fail due to the body stream already being consumed.
  try {
    return await handler(request.clone(), session, env);
  } catch (e) {
    if (String(e).includes("no such table: ns_orders: SQLITE_ERROR")) {
      await initTables(session);
      return await handler(request.clone(), session, env);
    }
    throw e;
  }
}

async function initTables(session: D1DatabaseSession) {
  return await session
    .prepare(
      `CREATE TABLE IF NOT EXISTS ns_orders(
			orderId INTEGER PRIMARY KEY,
			customerId INTEGER NOT NULL,
			customerEmail TEXT,
			customerName TEXT,
			title TEXT,
			status TEXT,
			total REAL,
			orderDate TEXT,
			orderItems TEXT,
			lastSynced TEXT DEFAULT CURRENT_TIMESTAMP
		)`,
    )
    .all();
}

async function resetTables(session: D1DatabaseSession) {
  try {
    await session.prepare("DROP TABLE IF EXISTS ns_orders").run();
  } catch (e) {
    console.error({
      message: "Failed to drop ns_orders table",
      error: String(e),
      errorProps: e,
    });
  }

  try {
    return await session
      .prepare(
        `CREATE TABLE IF NOT EXISTS ns_orders(
                        orderId INTEGER PRIMARY KEY,
                        customerId INTEGER NOT NULL,
                        customerEmail TEXT,
                        customerName TEXT,
                        title TEXT,
                        status TEXT,
                        total REAL,
                        orderDate TEXT,
                        orderItems TEXT,
                        lastSynced TEXT DEFAULT CURRENT_TIMESTAMP
                )`,
      )
      .run();
  } catch (e) {
    console.error({
      message: "Failed to create ns_orders table",
      error: String(e),
      errorProps: e,
    });
    throw e;
  }
}
