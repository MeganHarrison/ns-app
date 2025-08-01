import type { Metadata } from "next";
import { EcommerceMetrics } from "@/components/ecommerce/EcommerceMetrics";
import React from "react";
import MonthlyTarget from "@/components/ecommerce/MonthlyTarget";
import MonthlySalesChart from "@/components/ecommerce/MonthlySalesChart";
import StatisticsChart from "@/components/ecommerce/StatisticsChart";
import RecentOrders from "@/components/ecommerce/RecentOrders";
import DemographicCard from "@/components/ecommerce/DemographicCard";

// TODO: These imports need to be implemented or removed
import { KeapClient } from '../../../../workers/keap-client';
import { KeapXMLRPCClient, formatDateForKeap } from '../../../../workers/keap-xmlrpc-client';
import { SupabaseService, SupabaseOrder } from '../../supabase-client';
// import { DataSync } from './sync/data-sync';
// import { DashboardAnalytics } from './dashboard/analytics/dashboard-data';
// import { CacheService, CacheKeys, CacheTTL } from './cache/cache-service';
// import { WebhookHandler, WebhookPayload } from '../webhooks/webhook-handler';

// Fixed Nutrition Solutions Worker - Includes both analytics AND original keap-orders endpoint
export interface Env {
    DB01: D1Database;
    CACHE: KVNamespace;
    KEAP_SERVICE_ACCOUNT_KEY: string;
    KEAP_APP_ID?: string;
    SUPABASE_URL: string;
    SUPABASE_SERVICE_ROLE_KEY: string;
    WORKER_AUTH_TOKEN?: string;
  }
  
  interface KeapOrder {
    id: number;
    order_date: string;
    order_total: number;
    contact_id: number;
    order_title: string;
    order_type: string;
    payment_status: string;
    lead_affiliate_id?: number;
    order_items?: Array<{
      product_id: number;
      product_name: string;
      quantity: number;
      price: number;
    }>;
  }

export const metadata: Metadata = {
  title:
    "Nutrition Solutions",
  description: "Meal Prep without the Prep",
};

export default function Ecommerce() {
  return (
    <div className="grid grid-cols-12 gap-4 md:gap-6">
      <div className="col-span-12 space-y-6 xl:col-span-7">
        <EcommerceMetrics />

        <MonthlySalesChart />
      </div>

      <div className="col-span-12 xl:col-span-5">
        <MonthlyTarget />
      </div>

      <div className="col-span-12">
        <StatisticsChart />
      </div>

      <div className="col-span-12 xl:col-span-5">
        <DemographicCard />
      </div>

      <div className="col-span-12 xl:col-span-7">
        <RecentOrders />
      </div>
    </div>
  );
}
