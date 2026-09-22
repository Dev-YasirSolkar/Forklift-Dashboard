'use client';
import { useMemo } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Company, Forklift } from "@/lib/data";
import { TrendingUp, Warehouse } from "lucide-react";
import { useCollection, useFirebase, useMemoFirebase } from "@/firebase";
import { collection, query, orderBy } from "firebase/firestore";
import { cn } from "@/lib/utils";
import AppLayout from "@/components/app-layout";
import { ForkliftIcon } from '@/components/icons/forklift-icon';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, LabelList } from 'recharts';

export default function Dashboard() {
  const { firestore, user } = useFirebase();

  // Queries
  const forkliftsQuery = useMemoFirebase(() => firestore && user ? query(collection(firestore, 'forklifts')) : null, [firestore, user]);

  // Data fetching
  const { data: forklifts, isLoading: isLoadingForklifts } = useCollection<Forklift>(forkliftsQuery);

  const isLoading = isLoadingForklifts;

  // Stats calculation
  const stats = useMemo(() => {
    const totalFleet = forklifts?.length || 0;
    const deployedFleet = forklifts?.filter(f => f.locationType === 'On-Site').length || 0;
    const idleFleet = forklifts?.filter(f => f.locationType === 'Workshop').length || 0;
    const utilizationRate = totalFleet > 0 ? (deployedFleet / totalFleet) * 100 : 0;
    
    return { totalFleet, deployedFleet, idleFleet, utilizationRate };
  }, [forklifts]);
  
  // Chart data
  const forkliftLocationData = useMemo(() => {
    if (!forklifts) return [];
    const counts: Record<string, number> = {
      Workshop: 0,
      'On-Site': 0,
      'Not Confirm': 0,
      Sold: 0,
    };
    forklifts.forEach(f => {
      if (f.locationType && f.locationType in counts) {
        counts[f.locationType]++;
      }
    });
    return [
      { name: 'Workshop', value: counts.Workshop },
      { name: 'On-Site', value: counts['On-Site'] },
      { name: 'Not Confirmed', value: counts['Not Confirm'] },
      { name: 'Sold', value: counts.Sold },
    ].filter(item => item.value > 0);
  }, [forklifts]);
  
  const equipmentTypeData = useMemo(() => {
    if (!forklifts) return [];
    const counts = forklifts.reduce((acc, f) => {
        const type = f.equipmentType || 'Unknown';
        acc[type] = (acc[type] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);

    return Object.entries(counts).map(([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value);
  }, [forklifts]);


  const COLORS = {
      'Workshop': '#f97316', // orange-500
      'On-Site': '#22c55e', // green-500
      'Not Confirmed': '#ef4444' // red-500
  };

  const cardClassName = "border-0 bg-gradient-to-br shadow-lg";

  return (
    <AppLayout>
      <div className="flex flex-col gap-4 sm:gap-6">
        <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Business Analytics</h1>
              <p className="text-xs sm:text-sm text-muted-foreground">An overview of your fleet's performance and profitability.</p>
            </div>
          </div>
        <div className="grid gap-3 sm:gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          <Card className={cn(cardClassName, "from-blue-500 to-indigo-600 text-white shadow-blue-500/30")}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Fleet Utilization</CardTitle>
              <TrendingUp className="h-5 w-5 text-white/80" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl sm:text-3xl font-bold">{isLoading ? '...' : `${stats.utilizationRate.toFixed(0)}%`}</div>
              <p className="text-[10px] sm:text-xs text-white/90">Percentage of fleet actively earning revenue</p>
            </CardContent>
          </Card>
          <Card className={cn(cardClassName, "from-emerald-500 to-green-600 text-white shadow-emerald-500/30")}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Deployed Fleet</CardTitle>
              <ForkliftIcon className="h-5 w-5 text-white/80" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl sm:text-3xl font-bold">{isLoading ? '...' : stats.deployedFleet}</div>
              <p className="text-[10px] sm:text-xs text-white/90">Units on-site generating profit</p>
            </CardContent>
          </Card>
          <Card className={cn(cardClassName, "from-amber-500 to-orange-600 text-white shadow-amber-500/30")}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Idle Fleet</CardTitle>
              <Warehouse className="h-5 w-5 text-white/80" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl sm:text-3xl font-bold">{isLoading ? '...' : stats.idleFleet}</div>
              <p className="text-[10px] sm:text-xs text-white/90">Units in workshop, ready for deployment</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-7">
           <Card className="lg:col-span-4">
              <CardHeader>
                  <CardTitle>Fleet Composition by Type</CardTitle>
                  <CardDescription>
                      Breakdown of your fleet by equipment type.
                  </CardDescription>
              </CardHeader>
              <CardContent>
                  {isLoading ? (
                      <div className="h-[200px] sm:h-[250px] w-full flex items-center justify-center">
                          <p className="text-muted-foreground text-xs sm:text-sm">Loading chart...</p>
                      </div>
                  ) : equipmentTypeData.length > 0 ? (
                      <ResponsiveContainer width="100%" height={250}>
                          <BarChart data={equipmentTypeData} layout="vertical" margin={{ right: 40, left: 0, bottom: 20 }}>
                              <XAxis type="number" hide />
                              <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} width={80} fontSize={10} interval={0} />
                              <Tooltip
                                  cursor={{ fill: 'hsl(var(--accent))' }}
                                  contentStyle={{
                                      background: "hsl(var(--background))",
                                      borderColor: "hsl(var(--border))",
                                      fontSize: "12px"
                                  }}
                              />
                               <Bar dataKey="value" name="Count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]}>
                                 <LabelList dataKey="value" position="right" offset={8} className="fill-foreground" fontSize={10} />
                               </Bar>
                          </BarChart>
                      </ResponsiveContainer>
                  ) : (
                      <div className="h-[200px] sm:h-[250px] w-full flex items-center justify-center">
                          <p className="text-muted-foreground text-xs sm:text-sm">No equipment type data available.</p>
                      </div>
                  )}
              </CardContent>
          </Card>
          
          <Card className="lg:col-span-3">
            <CardHeader>
                <CardTitle>Fleet Status Distribution</CardTitle>
                <CardDescription>Live status of all forklifts in the fleet.</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                 <div className="h-[200px] sm:h-[250px] w-full flex items-center justify-center">
                   <p className="text-muted-foreground text-xs sm:text-sm">Loading chart...</p>
                 </div>
              ) : forkliftLocationData.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--background))",
                        borderColor: "hsl(var(--border))",
                        fontSize: "12px"
                      }}
                    />
                    <Pie
                        data={forkliftLocationData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={70}
                        paddingAngle={5}
                        label={({ percent }) => `${(percent * 100).toFixed(0)}%`}
                        labelLine={false}
                    >
                        {forkliftLocationData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[entry.name as keyof typeof COLORS]} />
                        ))}
                    </Pie>
                    <text
                        x="50%"
                        y="50%"
                        textAnchor="middle"
                        dominantBaseline="middle"
                        className="text-xl sm:text-2xl font-bold fill-foreground"
                    >
                        {stats.totalFleet}
                    </text>
                    <text
                        x="50%"
                        y="50%"
                        dy="1.2em"
                        textAnchor="middle"
                        dominantBaseline="middle"
                        className="text-[10px] sm:text-sm fill-muted-foreground"
                    >
                        Total Fleet
                    </text>
                    <Legend iconType="circle" verticalAlign="bottom" wrapperStyle={{ fontSize: '10px' }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[200px] sm:h-[250px] w-full flex items-center justify-center">
                   <p className="text-muted-foreground text-xs sm:text-sm">No forklift data available.</p>
                 </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
