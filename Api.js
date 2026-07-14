function doGet() {
  return ContentService
    .createTextOutput("DESK API OK")
    .setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {

  try {

    const payload = JSON.parse(
      e && e.postData && e.postData.contents
        ? e.postData.contents
        : "{}"
    );

    if (payload.token !== DESK_API_TOKEN) {
      return jsonResponse({
        success: false,
        error: "Unauthorized"
      });
    }

    if (payload.action === "getProject") {
      if (!payload.projectName) {
        return jsonResponse({
          success: false,
          error: "Missing projectName"
        });
      }

      return jsonResponse(
        ConversationEngine.getProject(payload.projectName)
      );
    }

    if (payload.action === "getWorkspaceBriefing") {
      return jsonResponse(
        ConversationEngine.getWorkspaceBriefing()
      );
    }

    const result = ConversationEngine.processConversationUpdate(
      payload.projectName,
      payload.data || {}
    );

    return jsonResponse({
      success: true,
      result: result
    });

  } catch (err) {

    return jsonResponse({
      success: false,
      error: err.message
    });

  }

}

function jsonResponse(data) {

  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);

}
