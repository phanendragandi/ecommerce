'use client'
import React, { useEffect, useState } from 'react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
  Cell,
} from 'recharts'
import Loading from '@/components/Loading'
import Footer from '@/components/seller/Footer'
import { useAppContext } from '@/context/AppContext'
import { api } from '@/lib/api'
import toast from 'react-hot-toast'

const STATUS_COLORS = {
  pending: '#9ca3af',
  paid: '#f97316',
  processing: '#3b82f6',
  shipped: '#8b5cf6',
  out_for_delivery: '#14b8a6',
  delivered: '#22c55e',
  cancelled: '#ef4444',
  refunded: '#eab308',
}

const REVENUE_TOOLTIP =
  "Revenue = sum of order_items.price_at_purchase × quantity for your items, in orders with payment_status = 'paid' (cancelled/refunded excluded)."

function isoDaysAgo(days) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

const StatCard = ({ label, value, hint }) => (
  <div className="bg-white border border-gray-500/20 rounded-md p-4 flex flex-col gap-1">
    <p className="text-sm text-gray-500">{label}</p>
    <p className="text-2xl font-semibold text-gray-800">{value}</p>
    {hint && <p className="text-xs text-gray-400">{hint}</p>}
  </div>
)

const Dashboard = () => {
  const { currency } = useAppContext()
  const [stats, setStats] = useState(null)
  const [series, setSeries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const from = isoDaysAgo(29)
      const to = isoDaysAgo(0)
      const [statsRes, salesRes] = await Promise.all([
        api.get('/api/seller/stats'),
        api.get(`/api/seller/reports/sales?from=${from}&to=${to}&interval=day`),
      ])
      setStats(statsRes?.data ?? null)
      setSeries(salesRes?.data?.series ?? [])
    } catch (err) {
      setError(err.message || 'Failed to load dashboard')
      toast.error(err.message || 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  if (loading) return <Loading />

  if (error) {
    return (
      <div className="flex-1 min-h-screen flex flex-col justify-between">
        <div className="md:p-10 p-4 flex flex-col items-center gap-4 py-20">
          <p className="text-gray-500">{error}</p>
          <button onClick={load} className="px-6 py-2 border rounded text-gray-500 hover:bg-slate-50 transition">
            Retry
          </button>
        </div>
        <Footer />
      </div>
    )
  }

  const statusData = Object.entries(stats?.status_breakdown ?? {}).map(([status, count]) => ({
    status: status.replace(/_/g, ' '),
    rawStatus: status,
    count,
  }))
  const hasStatusData = statusData.some((s) => s.count > 0)
  const lowStock = stats?.low_stock ?? []

  return (
    <div className="flex-1 min-h-screen flex flex-col justify-between">
      <div className="md:p-10 p-4 space-y-6">
        <h2 className="text-lg font-medium">Dashboard</h2>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Revenue" value={`${currency}${stats?.revenue ?? 0}`} hint="Paid orders only" />
          <StatCard label="Orders" value={stats?.order_count ?? 0} />
          <StatCard label="Avg. Order Value" value={`${currency}${stats?.aov ?? 0}`} hint="Per paid order" />
          <StatCard label="Units Sold" value={stats?.units_sold ?? 0} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 bg-white border border-gray-500/20 rounded-md p-4">
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
              <p className="font-medium text-gray-800">Revenue — last 30 days</p>
              <span className="text-xs text-gray-400 cursor-help" title={REVENUE_TOOLTIP}>
                What counts as revenue?
              </span>
            </div>
            {series.length === 0 ? (
              <p className="text-gray-400 text-sm py-16 text-center">No sales data yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={series}>
                  <defs>
                    <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f97316" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="bucket" tick={{ fontSize: 11 }} minTickGap={20} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip formatter={(value, name) => [name === 'revenue' ? `${currency}${value}` : value, name]} />
                  <Area type="monotone" dataKey="revenue" stroke="#f97316" fill="url(#revenueFill)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="bg-white border border-gray-500/20 rounded-md p-4">
            <p className="font-medium text-gray-800 mb-2">Orders by status</p>
            {!hasStatusData ? (
              <p className="text-gray-400 text-sm py-16 text-center">No orders yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={statusData} layout="vertical" margin={{ left: 16, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="status" width={90} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {statusData.map((entry) => (
                      <Cell key={entry.rawStatus} fill={STATUS_COLORS[entry.rawStatus] ?? '#f97316'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="bg-white border border-gray-500/20 rounded-md p-4">
          <p className="font-medium text-gray-800 mb-2">Low stock (5 or fewer units)</p>
          {lowStock.length === 0 ? (
            <p className="text-gray-400 text-sm py-6 text-center">Nothing running low right now.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-gray-500 text-left">
                  <tr>
                    <th className="py-2 pr-4 font-medium">Product</th>
                    <th className="py-2 font-medium">Stock left</th>
                  </tr>
                </thead>
                <tbody>
                  {lowStock.map((p) => (
                    <tr key={p.id} className="border-t border-gray-100">
                      <td className="py-2 pr-4 text-gray-700">{p.name}</td>
                      <td className="py-2">
                        <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-xs font-medium">
                          {p.stock}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      <Footer />
    </div>
  )
}

export default Dashboard
