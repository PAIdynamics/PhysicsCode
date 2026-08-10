import { Button } from "@physicscode-ai/ui/button"
import { Tag } from "@physicscode-ai/ui/tag"
import { useDialog } from "@physicscode-ai/ui/context/dialog"
import { showToast } from "@physicscode-ai/ui/toast"
import { createQuery, useMutation, useQueryClient } from "@tanstack/solid-query"
import { createMemo, For, Show } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { SettingsList } from "./settings-list"
import { DialogPaidynamicsLogin } from "./dialog-paidynamics-login"

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error) return error
  return fallback
}

export function SettingsAccount() {
  const dialog = useDialog()
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const queryClient = useQueryClient()

  const orgsQuery = createQuery(() => ({
    queryKey: ["experimental", "console", "orgs"],
    queryFn: async () => {
      const { data, error } = await globalSDK.client.experimental.console.listOrgs()
      if (!data || error) throw new Error(errorMessage(error, "Failed to load account status"))
      return data.orgs
    },
  }))

  const orgs = createMemo(() => orgsQuery.data ?? [])
  const accounts = createMemo(() => {
    const seen = new Map<string, { accountID: string; accountEmail: string; accountUrl: string }>()
    for (const org of orgs()) {
      if (seen.has(org.accountID)) continue
      seen.set(org.accountID, { accountID: org.accountID, accountEmail: org.accountEmail, accountUrl: org.accountUrl })
    }
    return [...seen.values()]
  })

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["experimental", "console"] })

  const switchMutation = useMutation(() => ({
    mutationFn: (input: { accountID: string; orgID: string }) => globalSDK.client.experimental.console.switchOrg(input),
    onSuccess: () => {
      invalidate()
      void queryClient.refetchQueries({ queryKey: ["bootstrap"] })
    },
    onError: (err) => {
      showToast({ title: language.t("common.requestFailed"), description: errorMessage(err, "Failed to switch org") })
    },
  }))

  const logoutMutation = useMutation(() => ({
    mutationFn: (accountID: string) => globalSDK.client.experimental.console.logout({ accountID }),
    onSuccess: () => {
      invalidate()
      void queryClient.refetchQueries({ queryKey: ["bootstrap"] })
      showToast({ variant: "success", icon: "circle-check", title: "Logged out of PhysicsCode" })
    },
    onError: (err) => {
      showToast({ title: language.t("common.requestFailed"), description: errorMessage(err, "Failed to log out") })
    },
  }))

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8 max-w-[720px]">
          <h2 class="text-16-medium text-text-strong">PhysicsCode Account</h2>
        </div>
      </div>

      <div class="flex flex-col gap-8 max-w-[720px]">
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">Account</h3>
          <SettingsList>
            <Show
              when={accounts().length > 0}
              fallback={
                <div class="flex flex-wrap items-center justify-between gap-4 min-h-16 py-3">
                  <div class="flex flex-col min-w-0">
                    <span class="text-14-regular text-text-weak">Not logged in</span>
                    <span class="text-12-regular text-text-weak">
                      Required for PAI-hosted models and the science agent.
                    </span>
                  </div>
                  <Button
                    size="large"
                    variant="secondary"
                    onClick={() => dialog.show(() => <DialogPaidynamicsLogin back="close" />)}
                  >
                    Log in
                  </Button>
                </div>
              }
            >
              <For each={accounts()}>
                {(account) => (
                  <div class="flex flex-wrap items-center justify-between gap-4 min-h-16 py-3 border-b border-border-weak-base last:border-none">
                    <div class="flex flex-col min-w-0">
                      <span class="text-14-medium text-text-strong truncate">{account.accountEmail}</span>
                      <span class="text-12-regular text-text-weak truncate">{account.accountUrl}</span>
                    </div>
                    <Button
                      size="large"
                      variant="ghost"
                      disabled={logoutMutation.isPending}
                      onClick={() => logoutMutation.mutate(account.accountID)}
                    >
                      {language.t("common.disconnect")}
                    </Button>
                  </div>
                )}
              </For>
            </Show>
          </SettingsList>
        </div>

        <Show when={orgs().length > 0}>
          <div class="flex flex-col gap-1">
            <h3 class="text-14-medium text-text-strong pb-2">Organizations</h3>
            <SettingsList>
              <For each={orgs()}>
                {(org) => (
                  <div class="flex flex-wrap items-center justify-between gap-4 min-h-16 py-3 border-b border-border-weak-base last:border-none">
                    <div class="flex items-center gap-3 min-w-0">
                      <span class="text-14-medium text-text-strong truncate">{org.orgName}</span>
                      <Show when={org.active}>
                        <Tag>Active</Tag>
                      </Show>
                    </div>
                    <Show when={!org.active}>
                      <Button
                        size="large"
                        variant="ghost"
                        disabled={switchMutation.isPending}
                        onClick={() => switchMutation.mutate({ accountID: org.accountID, orgID: org.orgID })}
                      >
                        Switch
                      </Button>
                    </Show>
                  </div>
                )}
              </For>
            </SettingsList>
          </div>
        </Show>
      </div>
    </div>
  )
}
