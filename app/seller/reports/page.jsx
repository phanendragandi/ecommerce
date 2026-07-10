'use client'
import React, { useCallback, useEffect, useState } from 'react'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import Loading from '@/components/Loading'
import Footer from '@/components/seller/Footer'
import { useAppContext } from '@/context/AppContext'
import { api } from '@/lib/api'
import toast from 'react-hot-toast'

const REVENUE_TOOLTIP =
  "Revenue = sum of order_items.price_at_purchase × quantity for your items, in orders with payment_status = 'paid' (cancelled/refunded excluded)."

function isoDaysAgo(days) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

const PRESETS = [
  { key: '7d', label: '7D', days: 7 },
  { key: '30d', label: '30D', days: 30 },
  { key: '90d', label: '90D', days: 90 },
]

// Prevent CSV/formula injection: a cell that starts with =, +, -, @, or a
// tab/CR can be interpreted as a live formula by Excel/Sheets when the file
// is opened. Prefixing with a single quote forces it to be read as text.
const FORMULA_INJECTION_RE = /^[=+\-@\t\r]/

function csvEscape(value) {
  let s = String(value ?? '')
  if (FORMULA_INJECTION_RE.test(s)) {
    s = `'${s}`
  }
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function rowsToCsv(rows) {
  return rows.map((row) => row.map(csvEscape).join(',')).join('\r\n')
}

function downloadCsv(filename, content) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.setAttribute('download', filename)
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

const Reports = () => {
  const { currency } = useAppContext()
  const [preset, setPreset] = useState('30d')
  const [from, setFrom] = useState(isoDaysAgo(29))
  const [to, setTo] = useState(isoDaysAgo(0))
  const [interval, setIntervalValue] = useState('day')

  const [series, setSeries] = useState([])
  const [topProducts, setTopProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async (rangeFrom, rangeTo, rangeInterval) => {
    setLoading(true)
    setError(null)
    try {
      const [salesRes, topRes] = await Promise.all([
        api.get(`/api/seller/reports/sales?from=${rangeFrom}&to=${rangeTo}&interval=${rangeInterval}`),
        api.get(`/api/seller/reports/top-products?from=${rangeFrom}&to=${rangeTo}&limit=10`),
      ])
      setSeries(salesRes?.data?.series ?? [])
      setTopProducts(topRes?.data?.products ?? [])
    } catch (err) {
      setError(err.message || 'Failed to load reports')
      toast.error(err.message || 'Failed to load reports')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(from, to, interval)
    // Initial load only — subsequent loads are user-triggered (preset / Apply / interval change).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const applyPreset = (p) => {
    const nextFrom = isoDaysAgo(p.days - 1)
    const nextTo = isoDaysAgo(0)
    setPreset(p.key)
    setFrom(nextFrom)
    setTo(nextTo)
    load(nextFrom, nextTo, interval)
  }

  const applyCustom = () => {
    if (!from || !to) {
      toast.error('Pick both a start and end date')
      return
    }
    if (from > to) {
      toast.error('Start date must be before the end date')
      return
    }
    setPreset('custom')
    load(from, to, interval)
  }

  const handleIntervalChange = (nextInterval) => {
    setIntervalValue(nextInterval)
    load(from, to, nextInterval)
  }

  const handleExport = () => {
    const rows = [
      ['QuickCart seller sales report'],
      ['Range', `${from} to ${to}`, 'Interval', interval],
      [],
      ['Bucket', 'Revenue', 'Units', 'Orders'],
      ...series.map((s) => [s.bucket, s.revenue, s.units, s.orders]),
      [],
      ['Top products'],
      ['Product', 'Units', 'Revenue'],
      ...topProducts.map((p) => [p.name, p.units, p.revenue]),
    ]
    downloadCsv(`seller-report-${from}_to_${to}.csv`, rowsToCsv(rows))
  }

  const totalRevenue = Math.round(series.reduce((sum, s) => sum + s.revenue, 0) * 100) / 100
  const totalUnits = series.reduce((sum, s) => sum + s.units, 0)
  const totalOrders = series.reduce((sum, s) => sum + s.orders, 0)

  return (
    <div className="flex-1 min-h-screen flex flex-col justify-between">
      <div className="md:p-10 p-4 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-lg font-medium">Reports</h2>
          <button
            onClick={handleExport}
            disabled={loading || (series.length === 0 && topProducts.length === 0)}
            className="px-4 py-2 bg-orange-600 text-white text-sm font-medium rounded disabled:opacity-50"
          >
            Export CSV
          </button>
        </div>

        <div className="bg-white border border-gray-500/20 rounded-md p-4 flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                onClick={() => applyPreset(p)}
                className={`px-3 py-1.5 text-sm rounded border transition ${
                  preset === p.key
                    ? 'bg-orange-600 text-white border-orange-600'
                    : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {p.label}
              </button>
            ))}
            <span
              className={`px-3 py-1.5 text-sm rounded border ${
                preset === 'custom' ? 'bg-orange-600 text-white border-orange-600' : 'border-gray-300 text-gray-400'
              }`}
            >
              Custom
            </span>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500" htmlFor="report-from">From</label>
              <input
                id="report-from"
                type="date"
                value={from}
                max={to}
                onChange={(e) => setFrom(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500" htmlFor="report-to">To</label>
              <input
                id="report-to"
                type="date"
                value={to}
                min={from}
                onChange={(e) => setTo(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500" htmlFor="report-interval">Interval</label>
              <select
                id="report-interval"
                value={interval}
                onChange={(e) => handleIntervalChange(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm"
              >
                <option value="day">Day</option>
                <option value="week">Week</option>
                <option value="month">Month</option>
              </select>
            </div>
            <button
              onClick={applyCustom}
              className="px-4 py-1.5 text-sm border border-gray-300 rounded text-gray-600 hover:bg-gray-50"
            >
              Apply
            </button>
          </div>
        </div>

        {loading ? (
          <Loading />
        ) : error ? (
          <div className="flex flex-col items-center gap-4 py-16">
            <p className="text-gray-500">{error}</p>
            <button
              onClick={() => load(from, to, interval)}
              className="px-6 py-2 border rounded text-gray-500 hover:bg-slate-50 transition"
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-white border border-gray-500/20 rounded-md p-4">
                <p className="text-sm text-gray-500">Revenue</p>
                <p className="text-xl font-semibold text-gray-800">{currency}{totalRevenue}</p>
              </div>
              <div className="bg-white border border-gray-500/20 rounded-md p-4">
                <p className="text-sm text-gray-500">Units</p>
                <p className="text-xl font-semibold text-gray-800">{totalUnits}</p>
              </div>
              <div className="bg-white border border-gray-500/20 rounded-md p-4">
                <p className="text-sm text-gray-500">Orders</p>
                <p className="text-xl font-semibold text-gray-800">{totalOrders}</p>
              </div>
            </div>

            <div className="bg-white border border-gray-500/20 rounded-md p-4">
              <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                <p className="font-medium text-gray-800">Revenue over time</p>
                <span className="text-xs text-gray-400 cursor-help" title={REVENUE_TOOLTIP}>
                  What counts as revenue?
                </span>
              </div>
              {series.length === 0 ? (
                <p className="text-gray-400 text-sm py-16 text-center">No sales data in this range.</p>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={series}>
                    <defs>
                      <linearGradient id="reportRevenueFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f97316" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="bucket" tick={{ fontSize: 11 }} minTickGap={20} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip formatter={(value, name) => [name === 'revenue' ? `${currency}${value}` : value, name]} />
                    <Area type="monotone" dataKey="revenue" stroke="#f97316" fill="url(#reportRevenueFill)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="bg-white border border-gray-500/20 rounded-md p-4">
              <p className="font-medium text-gray-800 mb-2">Sales by bucket</p>
              {series.length === 0 ? (
                <p className="text-gray-400 text-sm py-6 text-center">No data.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-gray-500 text-left">
                      <tr>
                        <th className="py-2 pr-4 font-medium">Bucket</th>
                        <th className="py-2 pr-4 font-medium">Revenue</th>
                        <th className="py-2 pr-4 font-medium">Units</th>
                        <th className="py-2 font-medium">Orders</th>
                      </tr>
                    </thead>
                    <tbody>
                      {series.map((s) => (
                        <tr key={s.bucket} className="border-t border-gray-100">
                          <td className="py-2 pr-4 text-gray-700">{s.bucket}</td>
                          <td className="py-2 pr-4 text-gray-700">{currency}{s.revenue}</td>
                          <td className="py-2 pr-4 text-gray-700">{s.units}</td>
                          <td className="py-2 text-gray-700">{s.orders}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="bg-white border border-gray-500/20 rounded-md p-4">
              <p className="font-medium text-gray-800 mb-2">Top products</p>
              {topProducts.length === 0 ? (
                <p className="text-gray-400 text-sm py-6 text-center">No sales in this range.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-gray-500 text-left">
                      <tr>
                        <th className="py-2 pr-4 font-medium">Product</th>
                        <th className="py-2 pr-4 font-medium">Units</th>
                        <th className="py-2 font-medium">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topProducts.map((p) => (
                        <tr key={p.product_id} className="border-t border-gray-100">
                          <td className="py-2 pr-4 text-gray-700">{p.name}</td>
                          <td className="py-2 pr-4 text-gray-700">{p.units}</td>
                          <td className="py-2 text-gray-700">{currency}{p.revenue}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
      <Footer />
    </div>
  )
}

export default Reports
