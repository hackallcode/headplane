import { Computer, FileKey2, LogIn, Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";

import ActionDialog from "~/components/action-dialog";
import CodeBlock from "~/components/code-block";
import { Dialog, DialogDescription, DialogTitle } from "~/components/dialog";
import Input from "~/components/input";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "~/components/menu";
import Select from "~/components/select";
import type { User } from "~/types";
import { normalizeRegistrationKey } from "~/utils/register-key";
import { getUserDisplayName, sortUsersByDisplayName } from "~/utils/user";

export interface NewMachineProps {
  server: string;
  users: User[];
  isDisabled?: boolean;
  disabledKeys?: string[];
}

export default function NewMachine(data: NewMachineProps) {
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <>
      <Dialog onOpenChange={setIsLoginOpen} open={isLoginOpen}>
        <DialogTitle>Log in from the device</DialogTitle>
        <DialogDescription>
          Install Tailscale on the device, set its server to the address below and sign in with your
          account. The device shows up here once you confirm it in the browser.
        </DialogDescription>
        <CodeBlock>{data.server}</CodeBlock>
        <DialogDescription>
          Without a settings screen for the server (Windows, Linux), run this in a terminal:
        </DialogDescription>
        <CodeBlock>{`tailscale login --login-server=${data.server}`}</CodeBlock>
      </Dialog>
      <ActionDialog
        description="Run this on the device, then paste the key it prints."
        intent="register"
        onOpenChange={setIsRegisterOpen}
        open={isRegisterOpen}
        submitLabel="Register"
        title="Register a machine"
      >
        <CodeBlock>{`tailscale up --login-server=${data.server}`}</CodeBlock>
        <Input
          description="The registration URL or the full hskey-authreq-... key."
          label="Machine key"
          name="register_key"
          placeholder="hskey-authreq-XXXXXXXXXXXXXXXXXXXXXXXX"
          required
          validate={(value) =>
            normalizeRegistrationKey(String(value ?? ""))
              ? null
              : "Paste the registration URL or full hskey-authreq-... key."
          }
        />
        <Select
          items={sortUsersByDisplayName(data.users).map((user) => ({
            // Headscale's v1/node/register endpoint resolves the owner by
            // username via GetUserByName, so we must pass user.name (not id).
            value: user.name,
            label: getUserDisplayName(user),
          }))}
          label="Owner"
          name="user"
          placeholder="Select a user"
          required
        />
      </ActionDialog>
      <Menu disabled={data.isDisabled}>
        <MenuTrigger className="bg-ink text-ink-fg hover:bg-ink/90 h-8 gap-1.5 rounded-md px-3 text-sm font-medium">
          <Plus className="size-3.5" />
          Add machine
        </MenuTrigger>
        <MenuContent>
          <MenuItem onClick={() => setIsLoginOpen(true)}>
            <div className="flex items-center gap-x-3">
              <LogIn className="w-4" />
              Log in from the device
            </div>
          </MenuItem>
          <MenuItem
            disabled={data.disabledKeys?.includes("register")}
            onClick={() => setIsRegisterOpen(true)}
          >
            <div className="flex items-center gap-x-3">
              <Computer className="w-4" />
              Register machine key
            </div>
          </MenuItem>
          <MenuItem
            disabled={data.disabledKeys?.includes("pre-auth")}
            onClick={() => navigate("/settings/auth-keys")}
          >
            <div className="flex items-center gap-x-3">
              <FileKey2 className="w-4" />
              Create auth key
            </div>
          </MenuItem>
        </MenuContent>
      </Menu>
    </>
  );
}
