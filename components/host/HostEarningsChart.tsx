import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

type EarningsDatum = {
  month: string;
  earnings: number;
  expected: number;
};

type HostEarningsChartProps = {
  data: EarningsDatum[];
};

export function HostEarningsChart({ data }: HostEarningsChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        <XAxis
          dataKey="month"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11, fill: "#4B5563" }}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11, fill: "#4B5563" }}
          tickFormatter={(v) => `GBP ${v}`}
        />
        <Tooltip
          contentStyle={{
            borderRadius: 12,
            borderColor: "rgba(11, 13, 16, 0.12)",
            fontSize: 12,
          }}
          formatter={(value: number | string) => [`GBP ${value}`, "Earnings"]}
        />
        <Line
          type="monotone"
          dataKey="earnings"
          stroke="#0B0D10"
          strokeWidth={2.4}
          dot={false}
          activeDot={{ r: 5 }}
        />
        <Line
          type="monotone"
          dataKey="expected"
          stroke="#4B5563"
          strokeWidth={1.6}
          dot={false}
          strokeDasharray="4 4"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
