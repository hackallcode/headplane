export function addDeviceOptions(access: {
  writable: boolean;
  anyKeys: boolean;
  ownKeys: boolean;
  linked: boolean;
}) {
  const preAuth = access.anyKeys || (access.ownKeys && access.linked);
  return {
    disabled: !access.writable && !access.anyKeys && !access.ownKeys,
    register: access.writable,
    preAuth,
  };
}
