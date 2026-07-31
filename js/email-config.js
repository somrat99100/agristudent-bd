function getContactBlock(status) {
  const s = (status || "").toLowerCase();
  if (!s.includes("reject")) return "";
  const whatsappLink = "https://wa.me/8801753486065"; // 88 + number, no leading 0
  return `
    <tr>
      <td style="padding:22px 32px 0 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td bgcolor="#FDEDEA" style="background-color:#FDEDEA;border:1px solid #F0C7BA;border-left:3px solid #C1704D;border-radius:14px;padding:22px 22px;">
              <div style="color:#B5613D;font-size:12.5px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:12px;">
                Need Help With This?
              </div>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td valign="middle" style="padding-right:14px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td bgcolor="#25D366" style="background-color:#25D366;width:44px;height:44px;border-radius:50%;text-align:center;line-height:44px;font-size:20px;">
                          💬
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td valign="middle">
                    <div style="color:#223528;font-size:14.5px;font-weight:700;">Mizanur Rahman</div>
                    <div style="color:#5F6E60;font-size:12.5px;">Submission Support</div>
                  </td>
                </tr>
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;">
                <tr>
                  <td bgcolor="#25D366" style="background-color:#25D366;border-radius:999px;">
                    <a href="${whatsappLink}" target="_blank"
                       style="display:inline-block;padding:11px 22px;font-family:'Segoe UI',Arial,sans-serif;font-size:13px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:.2px;border-radius:999px;">
                      💬 Chat on WhatsApp
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}
