import { KeapClient, KeapOrder } from '../src/keap-client';

export interface SyncResult {
  totalOrders: number;
  syncedOrders: number;
  errors: string[];
}

export async function syncKeapOrders(
  session: D1DatabaseSession,
  keapClient: KeapClient
): Promise<SyncResult> {
  const result: SyncResult = {
    totalOrders: 0,
    syncedOrders: 0,
    errors: [],
  };

  try {
    const orders = await keapClient.getAllOrders();
    result.totalOrders = orders.length;

    for (const order of orders) {
      try {
        await upsertOrder(session, order);
        result.syncedOrders++;
      } catch (error) {
        result.errors.push(`Failed to sync order ${order.id}: ${String(error)}`);
      }
    }
  } catch (error) {
    result.errors.push(`Failed to fetch orders from Keap: ${String(error)}`);
  }

  return result;
}

async function upsertOrder(session: D1DatabaseSession, order: KeapOrder): Promise<void> {
  const customerName = order.contact
    ? `${order.contact.given_name || ''} ${order.contact.family_name || ''}`.trim()
    : '';

  const orderItems = JSON.stringify(
    order.order_items?.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      price: item.price?.amount || 0,
      productId: item.product?.id,
      productName: item.product?.name,
    })) || []
  );

  await session
    .prepare(
      `INSERT INTO ns_orders (
        orderId, customerId, customerEmail, customerName,
        title, status, total, orderDate, orderItems, lastSynced
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(orderId) DO UPDATE SET
        customerId = excluded.customerId,
        customerEmail = excluded.customerEmail,
        customerName = excluded.customerName,
        title = excluded.title,
        status = excluded.status,
        total = excluded.total,
        orderDate = excluded.orderDate,
        orderItems = excluded.orderItems,
        lastSynced = CURRENT_TIMESTAMP`
    )
    .bind(
      parseInt(order.id),
      parseInt(order.contact?.id || '0'),
      order.contact?.email || '',
      customerName,
      order.title || '',
      order.status || '',
      (order.total?.amount || 0) / 100, // Convert cents to dollars
      order.order_time || order.creation_time || '',
      orderItems
    )
    .run();
}
