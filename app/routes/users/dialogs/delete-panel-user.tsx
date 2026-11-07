import Dialog, { DialogPanel } from "~/components/dialog";
import Text from "~/components/text";
import Title from "~/components/title";

interface DeletePanelUserProps {
  headplaneUserId: string;
  displayName: string;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

export default function DeletePanelUser({
  headplaneUserId,
  displayName,
  isOpen,
  setIsOpen,
}: DeletePanelUserProps) {
  return (
    <Dialog isOpen={isOpen} onOpenChange={setIsOpen}>
      <DialogPanel variant="destructive">
        <Title>Delete {displayName}?</Title>
        <Text className="mb-6">
          This removes the Headplane user and signs it out. The account at the identity provider
          stays; it comes back here if it signs in again and is still allowed to.
        </Text>
        <input name="action_id" type="hidden" value="delete_panel_user" />
        <input name="headplane_user_id" type="hidden" value={headplaneUserId} />
      </DialogPanel>
    </Dialog>
  );
}
