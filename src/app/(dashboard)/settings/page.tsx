"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { settingsService, dailyRateService } from "@/services/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Settings as SettingsIcon, 
  Store, 
  TrendingUp, 
  UserCircle,
  Save,
  Loader2,
  Lock,
  Printer
} from "lucide-react";
import { toast } from "sonner";
import { useState, useEffect } from "react";
import { useAuthStore } from "@/store/authStore";

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore(state => state.user);
  const [activeTab, setActiveTab] = useState("shop");

  // Queries
  const { data: settings, isLoading: isSettingsLoading } = useQuery<any>({
    queryKey: ["settings", "all"],
    queryFn: () => settingsService.getAll(),
  });

  const { data: rates, isLoading: isRatesLoading } = useQuery<any>({
    queryKey: ["daily-rates", "today"],
    queryFn: () => dailyRateService.getToday(),
  });

  // Mutations
  const updateSettingsMutation = useMutation({
    mutationFn: (data: any) => settingsService.update(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      toast.success("Settings updated successfully ✓");
    },
    onError: (err: any) => toast.error(err.message)
  });

  const updateRatesMutation = useMutation({
    mutationFn: (data: any) => dailyRateService.update(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["daily-rates"] });
      toast.success("Rates updated successfully ✓");
    },
    onError: (err: any) => toast.error(err.message)
  });

  const handleSettingsSubmit = (e: any) => {
    e.preventDefault();
    const f = new FormData(e.target);
    updateSettingsMutation.mutate(Object.fromEntries(f.entries()));
  };

  const handleRatesSubmit = (e: any) => {
    e.preventDefault();
    const f = new FormData(e.target);
    updateRatesMutation.mutate({
      milkRate: Number(f.get("milkRate")),
      yogurtRate: Number(f.get("yogurtRate")),
    });
  };

  if (user?.role !== "ADMIN" && user?.role !== "MANAGER") {
    return <div className="h-64 flex flex-col items-center justify-center text-center p-8 space-y-4">
        <Lock className="w-16 h-16 text-gray-200" />
        <h2 className="text-xl font-bold">Access Restricted</h2>
        <p className="text-sm text-gray-500">Only Admins and Managers can modify system settings.</p>
    </div>;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold font-poppins tracking-tight">System Configuration</h1>
        <p className="text-sm text-gray-500">Customize shop info, rates and business rules</p>
      </div>

      <Tabs defaultValue="shop" onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="bg-white border p-1 scale-110 sm:scale-100 origin-left">
          <TabsTrigger value="shop" className="flex items-center gap-2"><Store className="w-4 h-4" /> Shop Info</TabsTrigger>
          <TabsTrigger value="rates" className="flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Daily Rates</TabsTrigger>
          {user?.role === "ADMIN" && <TabsTrigger value="security" className="flex items-center gap-2"><UserCircle className="w-4 h-4" /> Users</TabsTrigger>}
        </TabsList>

        <TabsContent value="shop">
          <Card className="border-none shadow-sm max-w-2xl">
            <CardHeader>
              <CardTitle>Shop Profile</CardTitle>
              <CardDescription>This information will appear on printed customer receipts</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSettingsSubmit} className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="space-y-2 col-span-2 sm:col-span-1">
                        <Label>Shop Name</Label>
                        <Input name="shopName" defaultValue={settings?.find((s: any) => s.key === "shopName")?.value} placeholder="Noon Dairy" />
                    </div>
                    <div className="space-y-2 col-span-2 sm:col-span-1">
                        <Label>Contact Phone</Label>
                        <Input name="shopPhone" defaultValue={settings?.find((s: any) => s.key === "shopPhone")?.value} placeholder="0300-XXXXXXX" />
                    </div>
                    <div className="space-y-2 col-span-2">
                        <Label>Address</Label>
                        <Input name="shopAddress" defaultValue={settings?.find((s: any) => s.key === "shopAddress")?.value} placeholder="Shop address details..." />
                    </div>
                     <div className="space-y-2 col-span-2">
                        <Label>Receipt Footer Message</Label>
                        <Input name="receiptFooter" defaultValue={settings?.find((s: any) => s.key === "receiptFooter")?.value} placeholder="Thank you for shopping!" />
                    </div>
                </div>
                <div className="flex justify-end pt-4">
                  <Button type="submit" className="px-8 flex items-center gap-2" disabled={updateSettingsMutation.isPending}>
                    {updateSettingsMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Save className="w-4 h-4" /> Save Settings</>}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rates">
          <Card className="border-none shadow-sm max-w-xl">
            <CardHeader>
              <CardTitle>Daily Commodities Rates</CardTitle>
              <CardDescription>Update prices for fast-moving items globally across the system</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleRatesSubmit} className="space-y-8">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                    <div className="bg-surface rounded-2xl p-6 text-center space-y-4 border border-transparent transition-all hover:border-primary/20">
                         <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center mx-auto shadow-sm">🥛</div>
                         <div className="space-y-1">
                            <Label className="text-[10px] font-black uppercase text-gray-400">Milk per KG</Label>
                            <Input 
                                name="milkRate" 
                                type="number" 
                                step="0.01" 
                                required 
                                defaultValue={rates?.milkRate} 
                                className="h-12 text-2xl font-black text-center bg-white border-none shadow-sm" 
                            />
                         </div>
                    </div>
                     <div className="bg-surface rounded-2xl p-6 text-center space-y-4 border border-transparent transition-all hover:border-primary/20">
                         <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center mx-auto shadow-sm">🫙</div>
                         <div className="space-y-1">
                            <Label className="text-[10px] font-black uppercase text-gray-400">Yogurt per KG</Label>
                            <Input 
                                name="yogurtRate" 
                                type="number" 
                                step="0.01" 
                                required 
                                defaultValue={rates?.yogurtRate} 
                                className="h-12 text-2xl font-black text-center bg-white border-none shadow-sm" 
                            />
                         </div>
                    </div>
                </div>

                <div className="bg-blue-50/50 p-4 rounded-xl flex items-start gap-3">
                    <Printer className="w-5 h-5 text-blue-500 mt-0.5" />
                    <p className="text-xs text-blue-700 leading-relaxed">
                        <b>Pro Tip:</b> Changing these rates will immediately update the quick-entry buttons in the POS and recalculate ongoing carts. Existing bills will remain unaffected.
                    </p>
                </div>

                <Button type="submit" size="lg" className="w-full h-14 text-lg font-bold" disabled={updateRatesMutation.isPending}>
                  {updateRatesMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : "Update Prices Now"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>
        
        {/* User management and other settings would go here */}
      </Tabs>
    </div>
  );
}
