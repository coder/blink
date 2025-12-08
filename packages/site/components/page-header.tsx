import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-medium">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        )}
      </div>
      {actions && <div>{actions}</div>}
    </div>
  );
}

interface PageContainerProps {
  children: ReactNode;
}

export function PageContainer({ children }: PageContainerProps) {
  return (
    <div className="w-full p-8 max-w-6xl mx-auto space-y-6">{children}</div>
  );
}
