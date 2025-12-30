export const formatRole = (role: string): string => {
  switch (role) {
    case "admin":
      return "Admin";
    case "member":
      return "Member";
    case "billing_admin":
      return "Admin";
    default:
      return role.charAt(0).toUpperCase() + role.slice(1);
  }
};

const getRoleDescription = (role: string): string => {
  switch (role) {
    case "admin":
      return "Can manage members & agents";
    case "member":
      return "Can view & chat with agents";
    case "billing_admin":
      return "Can manage members & agents";
    default:
      return "";
  }
};

export const formatDate = (date: string | Date): string => {
  return new Date(date).toLocaleDateString();
};
