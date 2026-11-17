# Primary implementation references

- [Supabase server-side clients for Next.js](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs)
- [Supabase Before User Created hook](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook)
- [Auth Admin createUser](https://supabase.com/docs/reference/javascript/auth-admin-createuser)
- [Supabase Auth Admin implementation](https://github.com/supabase/auth/blob/master/internal/api/admin.go): protected app metadata is applied inside the Auth transaction; role synchronization handles insertion and later metadata application.
- [Supabase Auth resend implementation](https://github.com/supabase/auth/blob/master/internal/api/resend.go): confirmation resend requires the Email provider; global signup blocking remains a separate control.
- [Supabase CLI configuration](https://supabase.com/docs/guides/local-development/cli/config)
- [Next.js authentication guide](https://nextjs.org/docs/app/guides/authentication)
- [Next.js Proxy](https://nextjs.org/docs/app/getting-started/proxy)
- [Razorpay Standard Checkout integration](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps)
- [Razorpay webhook validation](https://razorpay.com/docs/webhooks/validate-test)

Provider behavior and hosted dashboard labels can change. The codebase includes pinned dependencies and a hosted launch checklist so actual behavior is verified before payments are enabled.
