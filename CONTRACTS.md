CONTRACTS.md<br>
export type statusType = ‘published’ | ‘draft’ | ‘cancelled’ | ‘past’<br>
 
export interface IEvent{<br>
	id: string,<br>
	organizerId: string, <br>
	title: string,<br>
	description: string,<br>
	location: string,<br>
	category: string,<br>
	status: statusType,<br>
	startDateTime: string, <br>
	endDateTime: string, <br>
	capacity?: number,<br>
	createdAt: string,<br>
	updatedAt: string,<br>
	User: Array<Set<string>><br>
}

export interface IRSVP {<br>
	id: string,<br>
	eventId: string,<br>
	userId: string,<br>
	status: statusType,<br>
	createdAt: string<br>
}


createEventFromForm(res: Response): /src/controller/EventController<br>
Does basic type checks of the response to create a createFormInput and enforces mandatory fields. Checks that the response status is a statusType, checks if optional categories are categoryType. Event creation is not permitted for members, and is only allowable by staff and admin 


createEvent(eventForm): /src/service/EventService<br>
Validates inputs. Checks that the event date is not before the date of creation. Checks if start_time is after end_time. Newly created events start in a draft status not visible to members until published. Checks capacity is non-negative and non-zero.<br>
Used by: createEventFromForm.

addEvent(eventForm): /src/repository/InMemoryEventRepository<br>
Stores the event in memory using a dictionary queried by the event_id.

modifyEventFromForm(res: Response): /src/controller/EventController
Does basic type checking for the input fields and creates an event form. Event_id is mandatory. No role can edit a cancelled or past event. Event modification is only applicable to staff or admin roles. 

modifyEvent(event_id, eventForm): /src/controller/EventService<br>
Validates given inputs. Use the same rules as event creation for the given fields. Checks that the event date is not before the date of creation. Checks if start_time is after end_time. Checks capacity is non-negative and non-zero.

editEvent(event_id, eventForm): /src/repository/InMemoryEventRepository<br>
Replaces entry in repository. Keeps the same event_id. 



publishEvent(event_id): publishes an event that is a draft.<br>
Used by: Event publishing/cancellation (josh)


cancelEvent(event_id): cancels an event that is published. Only the event organizer or an admin can cancel the event. Once cancelled it is not possible to restore.<br>
Used by: Event publishing/cancellation (josh)<br>

getOrganizerEvents(organizerId): Gets all the events and event details of the events that the user who made the request is organizing. Includes published, draft, cancelled, and past events. <br>
Used by: organizer event dashboard (josh)<br>

getEventsAdmin(): gets event details of every event. Includes published, draft, cancelled, and past events.<br>
Used by: organizer event dashboard (josh)<<br>

getEventById(event_id, actingUserId, actingUserRole): Gets an event by its event_id, but returns NotFoundError if event is a draft and the user is not the organizer/admin or if the event doesn't exist. Otherwise returns the full IEvent. <br>
Used by: Event Editing, RSVP Toggle, Event Publishing/Cancellation, Waitlist Promotion

getEvent(event_id): Looks up and returns the event from the in-memory dictionary by event_id. Returns a result with the event or an EventNotFound error. <br>
Used by: getEventById

filterEvents(filters): Only returns published events. Filters by category and/or timeframe if provided. Returns EventValidationError for bad filter values. No filters = all published upcoming events. <br>
Used by: Event Search

getAllEvents(): Returns all events from the database. No filtering or auth checks. <br>
Used by: filterEvents 


toggleRSVPFromRequest(req: Request): /src/controller/RSVPController<br>
Parses the request for RSVP toggle. Extracts the eventId from params or body, and the actingUserId and actingUserRole from the session. Does only basic request checking, then calls toggleRSVP(eventId, actingUserId, actingUserRole).<br>
Used by:<br>
RSVP Toggle<br>



toggleRSVP(eventId, actingUserId, actingUserRole): /src/service/RSVPService<br>
Handles RSVP toggle business logic. Checks that the event exists and that the acting user is allowed to RSVP. Organizers and admins cannot RSVP. Users cannot RSVP to cancelled or past events.<br>
If no RSVP exists yet, creates a new RSVP:<br>
going if capacity allows<br>
waitlisted if the event is full<br>
If an active RSVP already exists, changes it to cancelled.<br>
If a cancelled RSVP exists, reactivates it:<br>
going if capacity allows<br>
waitlisted if the event is full<br>
Returns either the updated RSVP or a named error.<br>
Used by:<br>
toggleRSVPFromRequest<br>
waitlist promotion coordination later<br>


getRSVPByUserAndEvent(userId, eventId): /src/repository/InMemoryRSVPRepository<br>
Looks up an RSVP for a given user and event in the in-memory store. Returns the RSVP if found, otherwise returns null.<br>
Used by:<br>
toggleRSVP<br>


addRSVP(rsvpForm): /src/repository/InMemoryRSVPRepository<br>
Stores a new RSVP in the in-memory repository.<br>
Used by:<br>
toggleRSVP<br>


updateRSVPStatus(rsvpId, status): /src/repository/InMemoryRSVPRepository<br>
Updates the status of an existing RSVP while keeping the same RSVP id.<br>
Used by:<br>
toggleRSVP<br>
waitlist promotion<br>


countGoingRSVPs(eventId): /src/repository/InMemoryRSVPRepository<br>
Counts how many RSVPs for a given event currently have status going. Used for capacity checking.<br>
Used by:<br>
toggleRSVP<br>


Event Search (Tahsif)<br>
searchEventsFromRequest(req: Request): /src/controller/EventController<br>
Parses the search query from request query params and calls searchEvents(searchTerm).
Used by:<br>
Event Search<br>


searchEvents(searchTerm): /src/service/EventService<br>
Searches published upcoming events using the given search term. Matches against title, description, and location. If the query is empty, returns all published upcoming events.<br>
Returns either an array of matching events or an error for invalid input.
Used by:<br>
searchEventsFromRequest<br>


getSearchedEvents(searchTerm): /src/repository/InMemoryEventRepository<br>
Searches through in-memory events and returns the published upcoming events whose title, description, or location match the search term. If the term is empty, returns all published upcoming events.<br>
Used by:<br>
searchEvents<br>
Waitlist Promotion & RSVP Dashboard- Liyana<br>


promoteWaitlist(event_id): /src/service/RSVPService<br>
When a ‘going’ RSVP is cancelled, checks if there are any waitlisted RSVPs for the same event. If there are, promotes the earliest waitlisted RSVP to ‘going’. ]Cancellation and promotion must happen together as one operation. If there is no waitlisted RSVP, only cancellation happens.<br>
Used by: RSVP dashboard, RSVP toggle coordination<br>

getNextWaitlistedRSVP(event_id): /src/repository/InMemoryRSVPRepository<br>
Gets the earliest waitlisted RSVP for the given event using createdAt order. Returns the RSVP or null if there is no waitlisted RSVP.<br>
Used by: promoteWaitlist<br>


getWaitlistPosition(event_id, userId): /src/service/RSVPService<br>
Calculates the position of a waitlisted user for a given event. Position is based on createdAt order among all waitlisted RSVPs for that event. Returns the numeric position/ null if the user is not waitlisted.<br>
Used by: waitlist promotion, event detail page<br>


cancelRSVPWithPromotion(event_id, userId): /src/service/RSVPService<br>
Cancels the RSVP for the given user and event. If the RSVP being cancelled has status going, then calls promoteWaitlist(event_id). If the RSVP being cancelled has status waitlisted, no promotion happens. Returns the updated cancelled RSVP and, if applicable, the promoted RSVP.<br>
Used by: RSVP dashboard, RSVP toggle coordination<br>


getRSVPsByEvent(event_id): /src/repository/InMemoryRSVPRepository<br>
Returns all RSVPs for the given event. Used for finding waitlisted RSVPs and calculating waitlist positions.<br>
Used by: promoteWaitlist, getWaitlistPosition<br>


getMyRSVPDashboard(userId, role): /src/service/RSVPService<br>
Gets all RSVPs for the acting user joined with the related event details. Organizers should not have access to this page. Groups results into upcoming and past/cancelled sections. Upcoming includes going and waitlisted RSVPs for future events. Past/cancelled includes RSVPs for past events or cancelled events. Sorts each section in the correct order.<br>
Used by: getMyRSVPDashboardFromRequest<br>


getMyRSVPDashboardFromRequest(req: Request): /src/controller/RSVPController<br>
Gets acting user id and role from the session and calls getMyRSVPDashboard(userId, role). Returns the RSVP dashboard page data.<br>
Used by: My RSVPs Dashboard<br>

getRSVPsByUser(userId): /src/repository/InMemoryRSVPRepository<br>
Gets all RSVP records for the given user from the in-memory repository.<br>
Used by: getMyRSVPDashboard<br>


getEventsForRSVPs(rsvps): /src/repository/InMemoryEventRepository<br>
Gets the event details for a given list of RSVPs so the dashboard can show event title, date, category, and status alongside each RSVP.<br>
Used by: getMyRSVPDashboard<br>