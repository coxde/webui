import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { ReactiveFormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { createComponentFactory, mockProvider, Spectator } from '@ngneat/spectator/jest';
import { of, Subject } from 'rxjs';
import { fakeSuccessfulJob } from 'app/core/testing/utils/fake-job.utils';
import { NewTicketResponse } from 'app/interfaces/support.interface';
import { IxFormsModule } from 'app/pages/common/ix-forms/ix-forms.module';
import { FormErrorHandlerService } from 'app/pages/common/ix-forms/services/form-error-handler.service';
import { IxFormHarness } from 'app/pages/common/ix-forms/testing/ix-form.harness';
import { FileTicketFormComponent } from 'app/pages/system/general-settings/support/file-ticket-form/file-ticket-form.component';
import { WebSocketService, DialogService, SystemGeneralService } from 'app/services';
import { IxSlideInService } from 'app/services/ix-slide-in.service';

describe('FileTicketFormComponent', () => {
  const onCloseSubject$ = new Subject<boolean>();
  let spectator: Spectator<FileTicketFormComponent>;
  let loader: HarnessLoader;
  let ws: WebSocketService;
  let matDialog: MatDialog;

  const mockNewTicketResponse = {
    ticket: 1234,
    url: 'https://mock.url/ticket/1234',
  } as NewTicketResponse;

  const createComponent = createComponentFactory({
    component: FileTicketFormComponent,
    imports: [
      IxFormsModule,
      ReactiveFormsModule,
    ],
    providers: [
      mockProvider(DialogService),
      mockProvider(WebSocketService, {
        token: 'token.is.mocked',
        onCloseSubject$,
        call: jest.fn((method) => {
          switch (method) {
            case 'support.new_ticket':
              return of(mockNewTicketResponse);
            case 'support.attach_ticket':
              return of(fakeSuccessfulJob());
            case 'support.fetch_categories':
              return of({
                API: '11008',
                WebUI: '10004',
              });
          }
        }),
      }),
      mockProvider(IxSlideInService),
      mockProvider(FormErrorHandlerService),
      mockProvider(SystemGeneralService, {
        getTokenForJira: jest.fn(() => 'token.is.mocked'),
        setTokenForJira: jest.fn(),
      }),
    ],
  });

  beforeEach(() => {
    spectator = createComponent();
    loader = TestbedHarnessEnvironment.loader(spectator.fixture);
    ws = spectator.inject(WebSocketService);
    matDialog = spectator.inject(MatDialog);
    jest.spyOn(matDialog, 'open').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows current values when form is being opened', async () => {
    const form = await loader.getHarness(IxFormHarness);
    const values = await form.getValues();

    expect(values).toEqual(
      {
        Token: 'token.is.mocked',
        Category: '',
        Subject: '',
        Body: '',
        Type: 'Bug',
        'Attach Debug': false,
      },
    );
    expect(ws.call).toHaveBeenCalledWith('support.fetch_categories', ['token.is.mocked']);
  });
});
