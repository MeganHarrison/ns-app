// pages/dashboard.tsx - Next.js Dashboard Component
import React, { useState, useEffect } from 'react';
import { Line, Bar, Pie } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
);

interface DashboardData {
  metrics: {
    total_revenue: number;
    order_count: number;
    avg_order_value: number;
  };
  status_breakdown: Array<{
    status: string;
    count: number;
    revenue: number;
  }>;
  daily_sales: Array<{
    date: string;
    orders: number;
    revenue: number;
  }>;
  period_days: number;
}

interface Order {
  id: number;
  keap_id: string;
  customer_id: string;
  status: string;
  total: number;
  creation_date: string;
  modification_date: string;
  payment_status: string;
  tracking_number?: string;
}

const Dashboard: React.FC = () => {
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<string>('');
  const [period, setPeriod] = useState(30);
  const [page, setPage] = useState(1);

  // Fetch dashboard data
  const fetchDashboardData = async (days: number = 30) => {
    try {
      const response = await fetch(`/api/dashboard-data?days=${days}`);
      const data = await response.json();
      setDashboardData(data);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    }
  };

  // Fetch orders
  const fetchOrders = async (pageNum: number = 1, limit: number = 20) => {
    try {
      const response = await fetch(`/api/orders?page=${pageNum}&limit=${limit}`);
      const data = await response.json();
      setOrders(data.orders);
    } catch (error) {
      console.error('Error fetching orders:', error);
    }
  };

  // Trigger sync
  const triggerSync = async (fullSync: boolean = false) => {
    setSyncStatus('Syncing...');
    try {
      const response = await fetch(`/api/sync-orders?full_sync=${fullSync}`, {
        method: 'POST'
      });
      const result = await response.json();
      setSyncStatus(result.success ? 'Sync completed!' : 'Sync failed');
      
      // Refresh data after sync
      if (result.success) {
        await fetchDashboardData(period);
        await fetchOrders(page);
      }
    } catch (error) {
      setSyncStatus('Sync failed');
      console.error('Sync error:', error);
    }
    
    // Clear status after 3 seconds
    setTimeout(() => setSyncStatus(''), 3000);
  };

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      await Promise.all([
        fetchDashboardData(period),
        fetchOrders(page)
      ]);
      setLoading(false);
    };
    
    loadData();
  }, [period, page]);

  // Chart configurations
  const salesChartData = {
    labels: dashboardData?.daily_sales.map(d => new Date(d.date).toLocaleDateString()) || [],
    datasets: [
      {
        label: 'Revenue',
        data: dashboardData?.daily_sales.map(d => d.revenue) || [],
        borderColor: 'rgb(75, 192, 192)',
        backgroundColor: 'rgba(75, 192, 192, 0.2)',
        yAxisID: 'y',
      },
      {
        label: 'Orders',
        data: dashboardData?.daily_sales.map(d => d.orders) || [],
        borderColor: 'rgb(255, 99, 132)',
        backgroundColor: 'rgba(255, 99, 132, 0.2)',
        yAxisID: 'y1',
      },
    ],
  };

  const salesChartOptions = {
    responsive: true,
    interaction: {
      mode: 'index' as const,
      intersect: false,
    },
    scales: {
      x: {
        display: true,
        title: {
          display: true,
          text: 'Date'
        }
      },
      y: {
        type: 'linear' as const,
        display: true,
        position: 'left' as const,
        title: {
          display: true,
          text: 'Revenue ($)'
        }
      },
      y1: {
        type: 'linear' as const,
        display: true,
        position: 'right' as const,
        title: {
          display: true,
          text: 'Orders'
        },
        grid: {
          drawOnChartArea: false,
        },
      },
    },
    plugins: {
      legend: {
        position: 'top' as const,
      },
      title: {
        display: true,
        text: 'Daily Sales Performance',
      },
    },
  };

  const statusChartData = {
    labels: dashboardData?.status_breakdown.map(s => s.status) || [],
    datasets: [
      {
        data: dashboardData?.status_breakdown.map(s => s.count) || [],
        backgroundColor: [
          'rgba(255, 99, 132, 0.8)',
          'rgba(54, 162, 235, 0.8)',
          'rgba(255, 205, 86, 0.8)',
          'rgba(75, 192, 192, 0.8)',
          'rgba(153, 102, 255, 0.8)',
        ],
        borderWidth: 1,
      },
    ],
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex justify-between items-center">
            <h1 className="text-3xl font-bold text-gray-900">
              Nutrition Solutions Dashboard
            </h1>
            <div className="flex gap-4">
              <select
                value={period}
                onChange={(e) => setPeriod(Number(e.target.value))}
                className="px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
                <option value={365}>Last year</option>
              </select>
              <button
                onClick={() => triggerSync(false)}
                disabled={syncStatus === 'Syncing...'}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {syncStatus || 'Sync Orders'}
              </button>
              <button
                onClick={() => triggerSync(true)}
                disabled={syncStatus === 'Syncing...'}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                Full Sync
              </button>
            </div>
          </div>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <div className="bg-white rounded-lg shadow-md p-6">
            <h3 className="text-lg font-semibold text-gray-700 mb-2">Total Revenue</h3>
            <p className="text-3xl font-bold text-green-600">
              {formatCurrency(dashboardData?.metrics.total_revenue || 0)}
            </p>
            <p className="text-sm text-gray-500">Last {period} days</p>
          </div>
          
          <div className="bg-white rounded-lg shadow-md p-6">
            <h3 className="text-lg font-semibold text-gray-700 mb-2">Total Orders</h3>
            <p className="text-3xl font-bold text-blue-600">
              {dashboardData?.metrics.order_count || 0}
            </p>
            <p className="text-sm text-gray-500">Last {period} days</p>
          </div>
          
          <div className="bg-white rounded-lg shadow-md p-6">
            <h3 className="text-lg font-semibold text-gray-700 mb-2">Avg Order Value</h3>
            <p className="text-3xl font-bold text-purple-600">
              {formatCurrency(dashboardData?.metrics.avg_order_value || 0)}
            </p>
            <p className="text-sm text-gray-500">Last {period} days</p>
          </div>
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <div className="lg:col-span-2 bg-white rounded-lg shadow-md p-6">
            <Line data={salesChartData} options={salesChartOptions} />
          </div>
          
          <div className="bg-white rounded-lg shadow-md p-6">
            <h3 className="text-lg font-semibold text-gray-700 mb-4">Order Status</h3>
            <Pie 
              data={statusChartData}
              options={{
                responsive: true,
                plugins: {
                  legend: {
                    position: 'bottom',
                  },
                },
              }}
            />
          </div>
        </div>

        {/* Recent Orders Table */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-gray-700">Recent Orders</h3>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300 disabled:opacity-50"
              >
                Previous
              </button>
              <span className="px-3 py-1">Page {page}</span>
              <button
                onClick={() => setPage(page + 1)}
                className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300"
              >
                Next
              </button>
            </div>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full table-auto">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-4 py-2 text-left">Order ID</th>
                  <th className="px-4 py-2 text-left">Customer</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-left">Total</th>
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-4 py-2 text-left">Payment</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-2 font-mono text-sm">{order.keap_id}</td>
                    <td className="px-4 py-2">{order.customer_id}</td>
                    <td className="px-4 py-2">
                      <span className={`px-2 py-1 rounded-full text-xs ${
                        order.status === 'completed' ? 'bg-green-100 text-green-800' :
                        order.status === 'processing' ? 'bg-blue-100 text-blue-800' :
                        order.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {order.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 font-semibold">{formatCurrency(order.total)}</td>
                    <td className="px-4 py-2 text-sm">{formatDate(order.creation_date)}</td>
                    <td className="px-4 py-2">
                      <span className={`px-2 py-1 rounded-full text-xs ${
                        order.payment_status === 'paid' ? 'bg-green-100 text-green-800' :
                        order.payment_status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-red-100 text-red-800'
                      }`}>
                        {order.payment_status || 'unknown'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;